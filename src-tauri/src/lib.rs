use serde::{Deserialize, Serialize};
use std::env;
use std::path::Path;
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitBranch {
    name: String,
    is_current: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitCommit {
    id: String,
    message: String,
    author: String,
    date: String,
    short_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileChange {
    path: String,
    status: String, // "added", "modified", "deleted"
    additions: u32,
    deletions: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileDiff {
    path: String,
    status: String,
    old_content: Option<String>,
    new_content: Option<String>,
    diff_lines: Vec<DiffLine>,
    is_binary: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffLine {
    line_type: String, // "context", "addition", "deletion", "header"
    content: String,
    old_line_number: Option<u32>,
    new_line_number: Option<u32>,
}

#[tauri::command]
fn get_git_branches() -> Result<Vec<GitBranch>, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let repo = git2::Repository::discover(current_dir).map_err(|e| e.to_string())?;
    
    let mut branches = Vec::new();
    let branch_iter = repo.branches(Some(git2::BranchType::Local)).map_err(|e| e.to_string())?;
    
    for branch_result in branch_iter {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        if let Some(name) = branch.name().map_err(|e| e.to_string())? {
            branches.push(GitBranch {
                name: name.to_string(),
                is_current: branch.is_head()
            });
        }
    }
    
    Ok(branches)
}

#[tauri::command]
fn get_git_branches_from_path(path: String) -> Result<Vec<GitBranch>, String> {
    let repo_path = Path::new(&path);
    let repo = git2::Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    let mut branches = Vec::new();
    let branch_iter = repo.branches(Some(git2::BranchType::Local)).map_err(|e| e.to_string())?;
    
    for branch_result in branch_iter {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        if let Some(name) = branch.name().map_err(|e| e.to_string())? {
            branches.push(GitBranch {
                name: name.to_string(),
                is_current: branch.is_head()
            });
        }
    }
    
    Ok(branches)
}

#[tauri::command]
fn get_commits_from_path(path: String, branch_name: String) -> Result<Vec<GitCommit>, String> {
    let repo_path = Path::new(&path);
    let repo = git2::Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    // Find the branch
    let branch = repo.find_branch(&branch_name, git2::BranchType::Local)
        .map_err(|e| e.to_string())?;
    let commit = branch.get().peel_to_commit().map_err(|e| e.to_string())?;
    
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push(commit.id()).map_err(|e| e.to_string())?;
    revwalk.set_sorting(git2::Sort::TIME).map_err(|e| e.to_string())?;
    
    let mut commits = Vec::new();
    let mut count = 0;
    
    for oid in revwalk {
        if count >= 50 { // Limit to first 50 commits
            break;
        }
        
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        
        let message = commit.message().unwrap_or("No message").to_string();
        let author = commit.author();
        let author_name = author.name().unwrap_or("Unknown").to_string();
        let date = commit.time();
        let date_str = format!("{}", chrono::DateTime::from_timestamp(date.seconds(), 0)
            .unwrap_or_default()
            .format("%Y-%m-%d %H:%M:%S"));
        
        commits.push(GitCommit {
            id: oid.to_string(),
            message: message.lines().next().unwrap_or(&message).to_string(),
            author: author_name,
            date: date_str,
            short_id: oid.to_string()[0..8].to_string(),
        });
        
        count += 1;
    }
    
    Ok(commits)
}

#[tauri::command]
fn get_commit_changes(path: String, commit_id: String) -> Result<Vec<FileChange>, String> {
    let repo_path = Path::new(&path);
    let repo = git2::Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    let oid = git2::Oid::from_str(&commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    
    let tree = commit.tree().map_err(|e| e.to_string())?;
    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0).map_err(|e| e.to_string())?.tree().map_err(|e| e.to_string())?)
    } else {
        None
    };
    
    let mut diff = repo.diff_tree_to_tree(
        parent_tree.as_ref(),
        Some(&tree),
        None
    ).map_err(|e| e.to_string())?;
    
    diff.find_similar(None).map_err(|e| e.to_string())?;
    
    let mut changes = Vec::new();
    
    diff.foreach(
        &mut |delta, _progress| {
            let status = match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Modified => "modified",
                git2::Delta::Renamed => "renamed",
                git2::Delta::Copied => "copied",
                _ => "unknown",
            };
            
            let path = delta.new_file().path()
                .or_else(|| delta.old_file().path())
                .and_then(|p| p.to_str())
                .unwrap_or("unknown")
                .to_string();
            
            changes.push(FileChange {
                path,
                status: status.to_string(),
                additions: 0, // Will be filled in the line callback
                deletions: 0,
            });
            
            true
        },
        None,
        None,
        None,
    ).map_err(|e| e.to_string())?;
    
    Ok(changes)
}

#[tauri::command]
fn get_file_diff(path: String, commit_id: String, file_path: String) -> Result<FileDiff, String> {
    let repo_path = Path::new(&path);
    let repo = git2::Repository::open(repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let oid = git2::Oid::from_str(&commit_id).map_err(|e| format!("Invalid commit ID: {}", e))?;
    let commit = repo.find_commit(oid).map_err(|e| format!("Commit not found: {}", e))?;
    
    let tree = commit.tree().map_err(|e| format!("Failed to get commit tree: {}", e))?;
    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0).map_err(|e| format!("Failed to get parent: {}", e))?.tree().map_err(|e| format!("Failed to get parent tree: {}", e))?)
    } else {
        None
    };
    
    // Create diff options with limits to prevent large diffs from causing issues
    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.context_lines(3);
    diff_opts.max_size(1024 * 1024); // 1MB limit
    
    let diff = repo.diff_tree_to_tree(
        parent_tree.as_ref(),
        Some(&tree),
        Some(&mut diff_opts)
    ).map_err(|e| format!("Failed to create diff: {}", e))?;
    
    // Find the specific file in the diff
    let mut file_found = false;
    let mut file_status = "unknown";
    let mut is_binary = false;
    
    // First pass: find if the file exists in this diff
    for (delta_idx, delta) in diff.deltas().enumerate() {
        let delta_path = delta.new_file().path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.to_str())
            .unwrap_or("unknown");
        
        if delta_path == file_path {
            file_found = true;
            file_status = match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Deleted => "deleted", 
                git2::Delta::Modified => "modified",
                git2::Delta::Renamed => "renamed",
                git2::Delta::Copied => "copied",
                _ => "unknown",
            };
            is_binary = delta.new_file().is_binary() || delta.old_file().is_binary();
            break;
        }
    }
    
    if !file_found {
        return Err(format!("File '{}' not found in commit changes", file_path));
    }
    
    if is_binary {
        return Ok(FileDiff {
            path: file_path,
            status: file_status.to_string(),
            old_content: None,
            new_content: None,
            diff_lines: Vec::new(),
            is_binary: true,
        });
    }
    
    // Generate patch for text files
    let mut patch_lines = Vec::new();
    
    for (delta_idx, delta) in diff.deltas().enumerate() {
        let delta_path = delta.new_file().path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.to_str())
            .unwrap_or("unknown");
        
        if delta_path == file_path {
            let patch = git2::Patch::from_diff(&diff, delta_idx).map_err(|e| format!("Failed to create patch: {}", e))?;
            
            if let Some(patch) = patch {
                for hunk_idx in 0..patch.num_hunks() {
                    let (hunk, hunk_lines) = patch.hunk(hunk_idx).map_err(|e| format!("Failed to get hunk: {}", e))?;
                    
                    for line_idx in 0..hunk_lines {
                        let line = patch.line_in_hunk(hunk_idx, line_idx).map_err(|e| format!("Failed to get line: {}", e))?;
                        
                        let line_content = String::from_utf8_lossy(line.content()).trim_end_matches('\n').to_string();
                        let line_type = match line.origin() {
                            '+' => "addition",
                            '-' => "deletion", 
                            ' ' => "context",
                            _ => "context",
                        };
                        
                        patch_lines.push(DiffLine {
                            line_type: line_type.to_string(),
                            content: line_content,
                            old_line_number: line.old_lineno(),
                            new_line_number: line.new_lineno(),
                        });
                    }
                }
            }
            break;
        }
    }
    
    Ok(FileDiff {
        path: file_path,
        status: file_status.to_string(),
        old_content: None,
        new_content: None,
        diff_lines: patch_lines,
        is_binary: false,
    })
}

#[tauri::command]
fn open_repo_dialog(app: tauri::AppHandle) {
    let _ = app.emit("menu-open-repo", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![get_git_branches, get_git_branches_from_path, get_commits_from_path, get_commit_changes, get_file_diff, open_repo_dialog])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .on_menu_event(|app, event| {
      match event.id().as_ref() {
        "open_repo" => {
          let _ = app.emit("menu-open-repo", ());
        }
        _ => {}
      }
    })
    .menu(|app| {
      #[cfg(target_os = "macos")]
      {
        use tauri::menu::*;
        
        let app_menu = SubmenuBuilder::new(app, "Git Viewer")
          .about(None)
          .separator()
          .quit()
          .build()?;
          
        let file_menu = SubmenuBuilder::new(app, "File")
          .item(&MenuItemBuilder::with_id("open_repo", "Open Repository...")
            .accelerator("Cmd+O")
            .build(app)?)
          .separator()
          .close_window()
          .build()?;
          
        MenuBuilder::new(app)
          .item(&app_menu)
          .item(&file_menu)
          .build()
      }
      
      #[cfg(not(target_os = "macos"))]
      {
        use tauri::menu::*;
        
        let file_menu = SubmenuBuilder::new(app, "File")
          .item(&MenuItemBuilder::with_id("open_repo", "Open Repository...")
            .accelerator("Ctrl+O")
            .build(app)?)
          .separator()
          .quit()
          .build()?;
          
        MenuBuilder::new(app)
          .item(&file_menu)
          .build()
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use tempfile::TempDir;

    fn create_test_git_repo() -> TempDir {
        let temp_dir = TempDir::new().expect("Failed to create temp directory");
        let repo_path = temp_dir.path();

        // Initialize git repo
        Command::new("git")
            .args(&["init"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to init git repo");

        // Configure git user for test repo
        Command::new("git")
            .args(&["config", "user.name", "Test User"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to configure git user name");

        Command::new("git")
            .args(&["config", "user.email", "test@example.com"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to configure git user email");

        // Create initial commit
        fs::write(repo_path.join("README.md"), "# Test Repo").expect("Failed to create README");
        Command::new("git")
            .args(&["add", "README.md"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to add README");

        Command::new("git")
            .args(&["commit", "-m", "Initial commit"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to create initial commit");

        temp_dir
    }

    #[test]
    fn test_get_git_branches_from_path_main_branch() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path().to_string_lossy().to_string();

        let result = get_git_branches_from_path(repo_path);
        assert!(result.is_ok());

        let branches = result.unwrap();
        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].name, "main");
        assert!(branches[0].is_current);
    }

    #[test]
    fn test_get_git_branches_from_path_multiple_branches() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path();

        // Create a new branch
        Command::new("git")
            .args(&["checkout", "-b", "feature-branch"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to create feature branch");

        // Switch back to main
        Command::new("git")
            .args(&["checkout", "main"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to switch to main");

        let result = get_git_branches_from_path(repo_path.to_string_lossy().to_string());
        assert!(result.is_ok());

        let branches = result.unwrap();
        assert_eq!(branches.len(), 2);

        // Find main and feature branches
        let main_branch = branches.iter().find(|b| b.name == "main").unwrap();
        let feature_branch = branches.iter().find(|b| b.name == "feature-branch").unwrap();

        assert!(main_branch.is_current);
        assert!(!feature_branch.is_current);
    }

    #[test]
    fn test_get_git_branches_from_path_invalid_path() {
        let result = get_git_branches_from_path("/invalid/path".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_get_git_branches_from_path_non_git_directory() {
        let temp_dir = TempDir::new().expect("Failed to create temp directory");
        let non_git_path = temp_dir.path().to_string_lossy().to_string();

        let result = get_git_branches_from_path(non_git_path);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_commits_from_path() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path().to_string_lossy().to_string();

        let result = get_commits_from_path(repo_path, "main".to_string());
        assert!(result.is_ok());

        let commits = result.unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].message, "Initial commit");
        assert!(commits[0].author.contains("Test User"));
        assert!(commits[0].short_id.len() == 8);
    }

    #[test]
    fn test_get_commits_from_path_invalid_branch() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path().to_string_lossy().to_string();

        let result = get_commits_from_path(repo_path, "nonexistent-branch".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_get_commit_changes() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path();

        // Get the commit ID from the initial commit
        let commits_result = get_commits_from_path(repo_path.to_string_lossy().to_string(), "main".to_string());
        assert!(commits_result.is_ok());
        let commits = commits_result.unwrap();
        assert!(!commits.is_empty());

        let commit_id = &commits[0].id;
        let result = get_commit_changes(repo_path.to_string_lossy().to_string(), commit_id.clone());
        assert!(result.is_ok());

        let changes = result.unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, "README.md");
        assert_eq!(changes[0].status, "added");
    }

    #[test]
    fn test_get_file_diff() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path();

        // Get the commit ID from the initial commit
        let commits_result = get_commits_from_path(repo_path.to_string_lossy().to_string(), "main".to_string());
        assert!(commits_result.is_ok());
        let commits = commits_result.unwrap();
        assert!(!commits.is_empty());

        let commit_id = &commits[0].id;
        let result = get_file_diff(
            repo_path.to_string_lossy().to_string(), 
            commit_id.clone(), 
            "README.md".to_string()
        );
        assert!(result.is_ok());

        let diff = result.unwrap();
        assert_eq!(diff.path, "README.md");
        assert_eq!(diff.status, "added");
        assert!(!diff.is_binary);
        assert!(!diff.diff_lines.is_empty());
    }
}
