use serde::{Deserialize, Serialize};
use std::env;
use std::path::Path;
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitBranch {
    name: String,
    is_current: bool,
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
fn open_repo_dialog(app: tauri::AppHandle) {
    let _ = app.emit("menu-open-repo", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![get_git_branches, get_git_branches_from_path, open_repo_dialog])
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
}
