use serde::{Deserialize, Serialize};
use std::env;
use std::path::Path;
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitBranch {
    name: String,
    is_current: bool,
    last_commit_date: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitRemote {
    name: String,
    url: String,
    is_push: bool,
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
pub struct StagedChange {
    path: String,
    status: String, // "added", "modified", "deleted", "renamed"
    old_path: Option<String>, // For renamed files
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStash {
    index: u32,
    message: String,
    commit_id: String,
    author: String,
    date: String,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    result_type: String, // "commit", "file", "content"
    commit_id: String,
    commit_message: String,
    commit_author: String,
    commit_date: String,
    file_path: Option<String>,
    content_preview: Option<String>,
    line_number: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BlameInfo {
    commit_id: String,
    commit_short_id: String,
    author: String,
    date: String,
    line_number: u32,
    content: String,
    commit_message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileBlame {
    path: String,
    blame_lines: Vec<BlameInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileTreeItem {
    name: String,
    path: String,
    is_directory: bool,
    children: Option<Vec<FileTreeItem>>,
    size: Option<u64>,
    file_type: String,
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
            // Get the last commit date for this branch
            let last_commit_date = match branch.get().peel_to_commit() {
                Ok(commit) => commit.time().seconds(),
                Err(_) => 0, // Default to epoch if we can't get the commit
            };
            
            branches.push(GitBranch {
                name: name.to_string(),
                is_current: branch.is_head(),
                last_commit_date,
            });
        }
    }
    
    // Sort branches by last commit date (descending - newest first)
    branches.sort_by(|a, b| b.last_commit_date.cmp(&a.last_commit_date));
    
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
            // Get the last commit date for this branch
            let last_commit_date = match branch.get().peel_to_commit() {
                Ok(commit) => commit.time().seconds(),
                Err(_) => 0, // Default to epoch if we can't get the commit
            };
            
            branches.push(GitBranch {
                name: name.to_string(),
                is_current: branch.is_head(),
                last_commit_date,
            });
        }
    }
    
    // Sort branches by last commit date (descending - newest first)
    branches.sort_by(|a, b| b.last_commit_date.cmp(&a.last_commit_date));
    
    Ok(branches)
}

#[tauri::command]
fn get_git_remotes_from_path(path: String) -> Result<Vec<GitRemote>, String> {
    let repo_path = Path::new(&path);
    let repo = git2::Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    let mut remotes = Vec::new();
    let remote_names = repo.remotes().map_err(|e| e.to_string())?;
    
    for remote_name in remote_names.iter() {
        if let Some(name) = remote_name {
            let remote = repo.find_remote(name).map_err(|e| e.to_string())?;
            
            // Get fetch URL
            if let Some(fetch_url) = remote.url() {
                remotes.push(GitRemote {
                    name: name.to_string(),
                    url: fetch_url.to_string(),
                    is_push: false,
                });
            }
            
            // Get push URL if different from fetch URL
            if let Some(push_url) = remote.pushurl() {
                if push_url != remote.url().unwrap_or("") {
                    remotes.push(GitRemote {
                        name: format!("{} (push)", name),
                        url: push_url.to_string(),
                        is_push: true,
                    });
                }
            }
        }
    }
    
    Ok(remotes)
}

#[tauri::command]
fn get_commits_from_path(path: String, branch_name: String) -> Result<Vec<GitCommit>, String> {
    let repo_path = Path::new(&path);
    let repo = git2::Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    // Find the branch, with fallback to HEAD if branch not found
    let branch = match repo.find_branch(&branch_name, git2::BranchType::Local) {
        Ok(branch) => branch,
        Err(_) => {
            // If the specific branch doesn't exist, try to get the HEAD branch
            let head = repo.head().map_err(|e| format!("Cannot find branch '{}' and HEAD reference not found: {}", branch_name, e))?;
            if head.is_branch() {
                repo.find_branch(
                    head.shorthand().unwrap_or("HEAD"),
                    git2::BranchType::Local
                ).map_err(|e| format!("Cannot find branch '{}': {}", branch_name, e))?
            } else {
                return Err(format!("Cannot find branch '{}' and HEAD is not pointing to a branch", branch_name));
            }
        }
    };
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
    for (_delta_idx, delta) in diff.deltas().enumerate() {
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
                    let (_hunk, hunk_lines) = patch.hunk(hunk_idx).map_err(|e| format!("Failed to get hunk: {}", e))?;
                    
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

#[tauri::command]
fn global_search(path: String, query: String, branch_name: Option<String>, max_commits: Option<u32>) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    
    let repo_path = Path::new(&path);
    let repo = git2::Repository::open(repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let query_lower = query.to_lowercase();
    
    // Determine which branch to search (default to current branch if not specified)
    let target_branch = if let Some(branch) = branch_name {
        branch
    } else {
        // Get current branch
        let head = repo.head().map_err(|e| format!("Failed to get HEAD: {}", e))?;
        let branch_name = head.shorthand().unwrap_or("HEAD").to_string();
        branch_name
    };
    
    // Find the branch and get commits
    let branch_result = repo.find_branch(&target_branch, git2::BranchType::Local);
    let branch = match branch_result {
        Ok(b) => b,
        Err(_) => {
            // If branch not found, try to resolve HEAD
            let head = repo.head().map_err(|e| format!("Failed to get HEAD: {}", e))?;
            let commit = head.peel_to_commit().map_err(|e| format!("Failed to get commit: {}", e))?;
            
            // Search in recent commits from HEAD
            let mut revwalk = repo.revwalk().map_err(|e| format!("Failed to create revwalk: {}", e))?;
            revwalk.push(commit.id()).map_err(|e| format!("Failed to push commit: {}", e))?;
            revwalk.set_sorting(git2::Sort::TIME).map_err(|e| format!("Failed to set sorting: {}", e))?;
            
            return search_commits_and_content(&repo, revwalk, &query_lower, max_commits);
        }
    };
    
    let commit = branch.get().peel_to_commit().map_err(|e| format!("Failed to get commit: {}", e))?;
    let mut revwalk = repo.revwalk().map_err(|e| format!("Failed to create revwalk: {}", e))?;
    revwalk.push(commit.id()).map_err(|e| format!("Failed to push commit: {}", e))?;
    revwalk.set_sorting(git2::Sort::TIME).map_err(|e| format!("Failed to set sorting: {}", e))?;
    
    search_commits_and_content(&repo, revwalk, &query_lower, max_commits)
}

fn search_commits_and_content(repo: &git2::Repository, revwalk: git2::Revwalk, query: &str, max_commits: Option<u32>) -> Result<Vec<SearchResult>, String> {
    let mut results = Vec::new();
    let mut count = 0;
    const MAX_RESULTS: usize = 50;
    let max_commits_limit = max_commits.unwrap_or(100) as usize;
    
    for oid in revwalk {
        if count >= max_commits_limit || results.len() >= MAX_RESULTS {
            break;
        }
        
        let oid = oid.map_err(|e| format!("Failed to get OID: {}", e))?;
        let commit = repo.find_commit(oid).map_err(|e| format!("Failed to find commit: {}", e))?;
        
        // Skip merge commits (commits with more than 1 parent)
        if commit.parent_count() > 1 {
            count += 1;
            continue;
        }
        
        let message = commit.message().unwrap_or("No message").to_string();
        let author = commit.author();
        let author_name = author.name().unwrap_or("Unknown").to_string();
        let date = commit.time();
        let date_str = format!("{}", chrono::DateTime::from_timestamp(date.seconds(), 0)
            .unwrap_or_default()
            .format("%Y-%m-%d %H:%M:%S"));
        
        // Search in commit message
        if message.to_lowercase().contains(query) {
            results.push(SearchResult {
                result_type: "commit".to_string(),
                commit_id: oid.to_string(),
                commit_message: message.clone(),
                commit_author: author_name.clone(),
                commit_date: date_str.clone(),
                file_path: None,
                content_preview: Some(message.lines().next().unwrap_or(&message).to_string()),
                line_number: None,
            });
        }
        
        // Search in file names and content
        if let Err(_) = search_commit_files_and_content(repo, &commit, query, &mut results, &author_name, &date_str) {
            // Continue even if individual commit search fails
        }
        
        count += 1;
        
        if results.len() >= MAX_RESULTS {
            break;
        }
    }
    
    Ok(results)
}

fn search_commit_files_and_content(
    repo: &git2::Repository,
    commit: &git2::Commit,
    query: &str,
    results: &mut Vec<SearchResult>,
    author_name: &str,
    date_str: &str,
) -> Result<(), String> {
    let tree = commit.tree().map_err(|e| format!("Failed to get tree: {}", e))?;
    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0).map_err(|e| format!("Failed to get parent: {}", e))?.tree().map_err(|e| format!("Failed to get parent tree: {}", e))?)
    } else {
        None
    };
    
    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.context_lines(2);
    diff_opts.max_size(512 * 1024); // 512KB limit for content search
    
    let diff = repo.diff_tree_to_tree(
        parent_tree.as_ref(),
        Some(&tree),
        Some(&mut diff_opts)
    ).map_err(|e| format!("Failed to create diff: {}", e))?;
    
    for (delta_idx, delta) in diff.deltas().enumerate() {
        if results.len() >= 50 { // Limit results
            break;
        }
        
        let file_path = delta.new_file().path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.to_str())
            .unwrap_or("unknown");
        
        // Search in file names
        if file_path.to_lowercase().contains(query) {
            results.push(SearchResult {
                result_type: "file".to_string(),
                commit_id: commit.id().to_string(),
                commit_message: commit.message().unwrap_or("No message").lines().next().unwrap_or("").to_string(),
                commit_author: author_name.to_string(),
                commit_date: date_str.to_string(),
                file_path: Some(file_path.to_string()),
                content_preview: Some(format!("File: {}", file_path)),
                line_number: None,
            });
        }
        
        // Search in file content (only for text files)
        if !delta.new_file().is_binary() && !delta.old_file().is_binary() {
            if let Ok(Some(patch)) = git2::Patch::from_diff(&diff, delta_idx) {
                for hunk_idx in 0..patch.num_hunks() {
                    if let Ok((_, hunk_lines)) = patch.hunk(hunk_idx) {
                        for line_idx in 0..hunk_lines {
                            if let Ok(line) = patch.line_in_hunk(hunk_idx, line_idx) {
                                let line_content = String::from_utf8_lossy(line.content());
                                if line_content.to_lowercase().contains(query) {
                                    let preview = line_content.trim_end_matches('\n').to_string();
                                    let preview_truncated = if preview.len() > 100 {
                                        format!("{}...", &preview[..97])
                                    } else {
                                        preview
                                    };
                                    
                                    results.push(SearchResult {
                                        result_type: "content".to_string(),
                                        commit_id: commit.id().to_string(),
                                        commit_message: commit.message().unwrap_or("No message").lines().next().unwrap_or("").to_string(),
                                        commit_author: author_name.to_string(),
                                        commit_date: date_str.to_string(),
                                        file_path: Some(file_path.to_string()),
                                        content_preview: Some(preview_truncated),
                                        line_number: line.new_lineno().or(line.old_lineno()),
                                    });
                                    
                                    // Limit content results per file
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(())
}

#[tauri::command]
fn get_file_blame(path: String, commit_id: String, file_path: String) -> Result<FileBlame, String> {
    let repo_path = Path::new(&path);
    let repo = git2::Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    // Get the commit
    let oid = git2::Oid::from_str(&commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    
    // Get the tree
    let tree = commit.tree().map_err(|e| e.to_string())?;
    
    // Find the file in the tree
    let tree_entry = tree.get_path(Path::new(&file_path)).map_err(|e| {
        format!("File '{}' not found in commit '{}': {}", file_path, commit_id, e)
    })?;
    
    // Get the blob
    let blob = repo.find_blob(tree_entry.id()).map_err(|e| e.to_string())?;
    
    // Check if file is binary
    if blob.is_binary() {
        return Err("Cannot show blame for binary files".to_string());
    }
    
    // Check file size limits for performance
    const MAX_BLAME_SIZE: usize = 1024 * 1024; // 1MB
    const MAX_BLAME_LINES: usize = 3000; // 3000 lines
    
    if blob.size() > MAX_BLAME_SIZE {
        return Err(format!("File too large for blame view ({}KB > 1MB)", blob.size() / 1024));
    }
    
    // Get file content to check line count
    let content = String::from_utf8(blob.content().to_vec()).map_err(|e| format!("File is not valid UTF-8: {}", e))?;
    let line_count = content.lines().count();
    
    if line_count > MAX_BLAME_LINES {
        return Err(format!("File has too many lines for blame view ({} > {})", line_count, MAX_BLAME_LINES));
    }
    
    // Create blame options
    let mut blame_options = git2::BlameOptions::new();
    blame_options.track_copies_same_commit_moves(true);
    blame_options.track_copies_same_commit_copies(true);
    
    // Get blame for the file
    let blame = repo.blame_file(Path::new(&file_path), Some(&mut blame_options)).map_err(|e| e.to_string())?;
    
    let mut blame_lines = Vec::new();
    
    for (line_num, line_content) in content.lines().enumerate() {
        let line_number = (line_num + 1) as u32;
        
        // Get blame info for this line
        if let Some(hunk) = blame.get_line(line_number as usize) {
            let commit_oid = hunk.final_commit_id();
            let blame_commit = repo.find_commit(commit_oid).map_err(|e| e.to_string())?;
            
            // Get author and date info
            let author = blame_commit.author();
            let author_name = author.name().unwrap_or("Unknown").to_string();
            let commit_time = blame_commit.time();
            
            // Format date
            let date = chrono::DateTime::from_timestamp(commit_time.seconds(), 0)
                .map(|dt| dt.format("%Y-%m-%d").to_string())
                .unwrap_or_else(|| "Unknown".to_string());
            
            // Get commit message (first line only)
            let commit_message = blame_commit.message()
                .unwrap_or("No message")
                .lines()
                .next()
                .unwrap_or("")
                .to_string();
            
            blame_lines.push(BlameInfo {
                commit_id: commit_oid.to_string(),
                commit_short_id: commit_oid.to_string()[..8].to_string(),
                author: author_name,
                date,
                line_number,
                content: line_content.to_string(),
                commit_message,
            });
        } else {
            // Fallback for lines without blame info
            blame_lines.push(BlameInfo {
                commit_id: commit_id.clone(),
                commit_short_id: commit_id[..8].to_string(),
                author: "Unknown".to_string(),
                date: "Unknown".to_string(),
                line_number,
                content: line_content.to_string(),
                commit_message: "Unknown".to_string(),
            });
        }
    }
    
    Ok(FileBlame {
        path: file_path,
        blame_lines,
    })
}

#[tauri::command]
fn get_commit_file_tree(path: String, commit_id: String) -> Result<Vec<FileTreeItem>, String> {
    let repo_path = Path::new(&path);
    let repo = git2::Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    let oid = git2::Oid::from_str(&commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;
    
    fn get_file_type(name: &str) -> String {
        let extension = name.split('.').last().unwrap_or("").to_lowercase();
        match extension.as_str() {
            "js" | "jsx" => "javascript",
            "ts" | "tsx" => "typescript", 
            "py" => "python",
            "rs" => "rust",
            "java" => "java",
            "go" => "go",
            "c" | "h" => "c",
            "cpp" | "cc" | "cxx" | "hpp" => "cpp",
            "css" | "scss" | "sass" => "css",
            "html" | "htm" => "html",
            "json" => "json",
            "yaml" | "yml" => "yaml",
            "md" | "markdown" => "markdown",
            "sh" | "bash" | "zsh" => "shell",
            "sql" => "sql",
            "xml" => "xml",
            "toml" => "toml",
            "ini" | "cfg" | "conf" => "config",
            "dockerfile" => "docker",
            "gitignore" => "git",
            "txt" => "text",
            _ => "file"
        }.to_string()
    }
    
    fn build_tree_recursive(
        repo: &git2::Repository,
        tree: &git2::Tree,
        base_path: &str,
    ) -> Result<Vec<FileTreeItem>, String> {
        let mut items = Vec::new();
        
        for entry in tree.iter() {
            let name = entry.name().unwrap_or("unknown").to_string();
            let current_path = if base_path.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", base_path, name)
            };
            
            let object = entry.to_object(repo).map_err(|e| e.to_string())?;
            
            match object.kind() {
                Some(git2::ObjectType::Tree) => {
                    let subtree = object.as_tree().unwrap();
                    let children = build_tree_recursive(repo, subtree, &current_path)?;
                    
                    items.push(FileTreeItem {
                        name,
                        path: current_path,
                        is_directory: true,
                        children: Some(children),
                        size: None,
                        file_type: "folder".to_string(),
                    });
                }
                Some(git2::ObjectType::Blob) => {
                    let blob = object.as_blob().unwrap();
                    let file_type = get_file_type(&name);
                    
                    items.push(FileTreeItem {
                        name: name.clone(),
                        path: current_path,
                        is_directory: false,
                        children: None,
                        size: Some(blob.size() as u64),
                        file_type,
                    });
                }
                _ => {}
            }
        }
        
        // Sort items: directories first, then files, both alphabetically
        items.sort_by(|a, b| {
            match (a.is_directory, b.is_directory) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            }
        });
        
        Ok(items)
    }
    
    build_tree_recursive(&repo, &tree, "")
}

#[tauri::command]
fn open_file_in_editor(repo_path: String, commit_id: String, file_path: String) -> Result<(), String> {
    use std::process::Command;
    use std::fs;
    use std::io::Write;
    
    let repo_path_obj = Path::new(&repo_path);
    let repo = git2::Repository::open(repo_path_obj).map_err(|e| e.to_string())?;
    
    // Get the commit
    let oid = git2::Oid::from_str(&commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;
    
    // Find the file in the tree
    let tree_entry = tree.get_path(Path::new(&file_path)).map_err(|e| {
        format!("File '{}' not found in commit '{}': {}", file_path, commit_id, e)
    })?;
    
    // Get the blob
    let blob = repo.find_blob(tree_entry.id()).map_err(|e| e.to_string())?;
    
    // Check if file is binary
    if blob.is_binary() {
        return Err("Cannot open binary files in text editor".to_string());
    }
    
    // Get file content
    let content = String::from_utf8(blob.content().to_vec()).map_err(|e| format!("File is not valid UTF-8: {}", e))?;
    
    // Create temporary file
    let temp_dir = std::env::temp_dir();
    let file_name = Path::new(&file_path).file_name().unwrap_or_else(|| std::ffi::OsStr::new("temp_file"));
    let temp_file_path = temp_dir.join(format!("git_viewer_{}_{}", commit_id[..8].to_string(), file_name.to_string_lossy()));
    
    // Write content to temporary file
    let mut temp_file = fs::File::create(&temp_file_path).map_err(|e| format!("Failed to create temporary file: {}", e))?;
    temp_file.write_all(content.as_bytes()).map_err(|e| format!("Failed to write to temporary file: {}", e))?;
    
    let temp_file_str = temp_file_path.to_str().ok_or("Invalid temporary file path")?;
    
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-a")
            .arg("TextEdit")
            .arg(temp_file_str)
            .spawn()
            .map_err(|e| format!("Failed to open file in TextEdit: {}", e))?;
    }
    
    #[cfg(target_os = "windows")]
    {
        Command::new("notepad")
            .arg(temp_file_str)
            .spawn()
            .map_err(|e| format!("Failed to open file in Notepad: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        Command::new("gedit")
            .arg(temp_file_str)
            .spawn()
            .map_err(|e| format!("Failed to open file in gedit: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
fn get_staged_changes(path: String) -> Result<Vec<StagedChange>, String> {
    let repo_path = Path::new(&path);
    let repo = git2::Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    let mut staged_changes = Vec::new();
    
    // Use Git's status functionality to get staged files
    let mut status_options = git2::StatusOptions::new();
    status_options.include_untracked(false);
    status_options.include_ignored(false);
    
    let statuses = repo.statuses(Some(&mut status_options)).map_err(|e| e.to_string())?;
    
    for status_entry in statuses.iter() {
        let file_path = status_entry.path().unwrap_or("unknown");
        let status_flags = status_entry.status();
        
        // Check if the file is staged (in index)
        if status_flags.contains(git2::Status::INDEX_NEW) {
            staged_changes.push(StagedChange {
                path: file_path.to_string(),
                status: "added".to_string(),
                old_path: None,
            });
        } else if status_flags.contains(git2::Status::INDEX_MODIFIED) {
            staged_changes.push(StagedChange {
                path: file_path.to_string(),
                status: "modified".to_string(),
                old_path: None,
            });
        } else if status_flags.contains(git2::Status::INDEX_DELETED) {
            staged_changes.push(StagedChange {
                path: file_path.to_string(),
                status: "deleted".to_string(),
                old_path: None,
            });
        } else if status_flags.contains(git2::Status::INDEX_RENAMED) {
            staged_changes.push(StagedChange {
                path: file_path.to_string(),
                status: "renamed".to_string(),
                old_path: None, // TODO: Get the old path for renames
            });
        } else if status_flags.contains(git2::Status::INDEX_TYPECHANGE) {
            staged_changes.push(StagedChange {
                path: file_path.to_string(),
                status: "modified".to_string(),
                old_path: None,
            });
        }
    }
    
    Ok(staged_changes)
}

#[tauri::command]
fn get_staged_file_diff(path: String, file_path: String) -> Result<FileDiff, String> {
    let repo_path = Path::new(&path);
    let repo = git2::Repository::open(repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;
    
    // Get the index (staging area)
    let index = repo.index().map_err(|e| format!("Failed to get index: {}", e))?;
    
    // Get HEAD tree for comparison (if it exists)
    let head_tree = match repo.head() {
        Ok(head) => {
            let head_commit = head.peel_to_commit().map_err(|e| format!("Failed to get HEAD commit: {}", e))?;
            Some(head_commit.tree().map_err(|e| format!("Failed to get HEAD tree: {}", e))?)
        }
        Err(_) => None, // Repository has no commits yet
    };
    
    // Create diff options
    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.context_lines(3);
    diff_opts.max_size(1024 * 1024); // 1MB limit
    diff_opts.pathspec(file_path.clone());
    
    // Create diff between HEAD and index (staged changes)
    let diff = repo.diff_tree_to_index(
        head_tree.as_ref(),
        Some(&index),
        Some(&mut diff_opts)
    ).map_err(|e| format!("Failed to create diff: {}", e))?;
    
    // Find the specific file in the diff
    let mut file_found = false;
    let mut file_status = "unknown";
    let mut is_binary = false;
    
    // First pass: find if the file exists in this diff
    for (_delta_idx, delta) in diff.deltas().enumerate() {
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
        return Err(format!("File '{}' not found in staged changes", file_path));
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
                    let (_hunk, hunk_lines) = patch.hunk(hunk_idx).map_err(|e| format!("Failed to get hunk: {}", e))?;
                    
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
fn get_stashes(path: String) -> Result<Vec<GitStash>, String> {
    let repo_path = Path::new(&path);
    let mut repo = git2::Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    let mut stashes = Vec::new();
    
    // Use git2's stash foreach to iterate through stashes
    let repo_for_commit = git2::Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    repo.stash_foreach(|index, message, stash_id| {
        // Get the stash commit
        if let Ok(stash_commit) = repo_for_commit.find_commit(*stash_id) {
            let author = stash_commit.author();
            let timestamp = stash_commit.time();
            
            // Format the date
            let datetime = chrono::DateTime::from_timestamp(timestamp.seconds(), 0)
                .unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).unwrap());
            let formatted_date = datetime.format("%Y-%m-%d %H:%M:%S").to_string();
            
            stashes.push(GitStash {
                index: index as u32,
                message: message.to_string(),
                commit_id: stash_id.to_string(),
                author: format!("{} <{}>", 
                    author.name().unwrap_or("Unknown"), 
                    author.email().unwrap_or("unknown@email.com")),
                date: formatted_date,
            });
        }
        true // Continue iteration
    }).map_err(|e| e.to_string())?;
    
    Ok(stashes)
}

#[tauri::command]
fn get_stash_diff(path: String, stash_index: u32) -> Result<Vec<FileChange>, String> {
    let repo_path = Path::new(&path);
    let mut repo = git2::Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    // Get the stash commit by index
    let mut stash_commit_id = None;
    let mut current_index = 0;
    
    repo.stash_foreach(|index, _message, stash_id| {
        if index as u32 == stash_index {
            stash_commit_id = Some(*stash_id);
            false // Stop iteration
        } else {
            current_index = index;
            true // Continue iteration
        }
    }).map_err(|e| e.to_string())?;
    
    let stash_oid = stash_commit_id.ok_or("Stash not found")?;
    let stash_commit = repo.find_commit(stash_oid).map_err(|e| e.to_string())?;
    
    // Get the parent commit (the commit the stash was based on)
    let parent_commit = stash_commit.parent(0).map_err(|e| e.to_string())?;
    
    // Create diff between parent and stash
    let parent_tree = parent_commit.tree().map_err(|e| e.to_string())?;
    let stash_tree = stash_commit.tree().map_err(|e| e.to_string())?;
    
    let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&stash_tree), None)
        .map_err(|e| e.to_string())?;
    
    let mut changes = Vec::new();
    
    for (_, delta) in diff.deltas().enumerate() {
        let file_path = delta.new_file().path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.to_str())
            .unwrap_or("unknown");
        
        let status = match delta.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted", 
            git2::Delta::Modified => "modified",
            git2::Delta::Renamed => "renamed",
            git2::Delta::Copied => "copied",
            _ => "unknown",
        };
        
        // Get line count stats
        let stats = diff.stats().map_err(|e| e.to_string())?;
        
        changes.push(FileChange {
            path: file_path.to_string(),
            status: status.to_string(),
            additions: stats.insertions() as u32,
            deletions: stats.deletions() as u32,
        });
    }
    
    Ok(changes)
}

#[tauri::command]
fn get_stash_file_diff(path: String, stash_index: u32, file_path: String) -> Result<FileDiff, String> {
    let repo_path = Path::new(&path);
    let mut repo = git2::Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    // Get the stash commit by index
    let mut stash_commit_id = None;
    
    repo.stash_foreach(|index, _message, stash_id| {
        if index as u32 == stash_index {
            stash_commit_id = Some(*stash_id);
            false // Stop iteration
        } else {
            true // Continue iteration
        }
    }).map_err(|e| e.to_string())?;
    
    let stash_oid = stash_commit_id.ok_or("Stash not found")?;
    let stash_commit = repo.find_commit(stash_oid).map_err(|e| e.to_string())?;
    
    // Get the parent commit
    let parent_commit = stash_commit.parent(0).map_err(|e| e.to_string())?;
    
    // Create diff between parent and stash for specific file
    let parent_tree = parent_commit.tree().map_err(|e| e.to_string())?;
    let stash_tree = stash_commit.tree().map_err(|e| e.to_string())?;
    
    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.context_lines(3);
    diff_opts.pathspec(file_path.clone());
    
    let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&stash_tree), Some(&mut diff_opts))
        .map_err(|e| e.to_string())?;
    
    // Find the specific file in the diff
    let mut file_found = false;
    let mut file_status = "unknown";
    let mut is_binary = false;
    
    for (_delta_idx, delta) in diff.deltas().enumerate() {
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
        return Err(format!("File '{}' not found in stash changes", file_path));
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
                    let (_hunk, hunk_lines) = patch.hunk(hunk_idx).map_err(|e| format!("Failed to get hunk: {}", e))?;
                    
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
fn get_file_content(path: String, commit_id: String, file_path: String) -> Result<String, String> {
    let repo_path = Path::new(&path);
    let repo = git2::Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    let oid = git2::Oid::from_str(&commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;
    
    // Find the file in the tree
    let tree_entry = tree.get_path(Path::new(&file_path)).map_err(|e| {
        format!("File '{}' not found in commit '{}': {}", file_path, commit_id, e)
    })?;
    
    // Get the blob
    let blob = repo.find_blob(tree_entry.id()).map_err(|e| e.to_string())?;
    
    // Check if file is binary
    if blob.is_binary() {
        return Err("Cannot display binary file content".to_string());
    }
    
    // Check file size limits for performance
    const MAX_FILE_SIZE: usize = 1024 * 1024; // 1MB
    
    if blob.size() > MAX_FILE_SIZE {
        return Err(format!("File too large to display ({}KB > 1MB)", blob.size() / 1024));
    }
    
    // Get file content
    let content = String::from_utf8(blob.content().to_vec()).map_err(|e| format!("File is not valid UTF-8: {}", e))?;
    
    Ok(content)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![get_git_branches, get_git_branches_from_path, get_git_remotes_from_path, get_commits_from_path, get_commit_changes, get_file_diff, open_repo_dialog, global_search, get_file_blame, get_commit_file_tree, get_file_content, open_file_in_editor, get_staged_changes, get_staged_file_diff, get_stashes, get_stash_diff, get_stash_file_diff])
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

    #[test]
    fn test_global_search_empty_query() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path().to_string_lossy().to_string();

        let result = global_search(repo_path, "".to_string(), Some("main".to_string()), None);
        assert!(result.is_ok());
        let results = result.unwrap();
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_global_search_commit_message() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path().to_string_lossy().to_string();

        let result = global_search(repo_path, "Initial".to_string(), Some("main".to_string()), None);
        assert!(result.is_ok());
        let results = result.unwrap();
        
        // Should find the "Initial commit" message
        assert!(!results.is_empty());
        let commit_result = results.iter().find(|r| r.result_type == "commit");
        assert!(commit_result.is_some());
        
        let commit_result = commit_result.unwrap();
        assert!(commit_result.commit_message.to_lowercase().contains("initial"));
        assert_eq!(commit_result.result_type, "commit");
        assert!(commit_result.file_path.is_none());
    }

    #[test]
    fn test_global_search_file_name() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path().to_string_lossy().to_string();

        let result = global_search(repo_path, "README".to_string(), Some("main".to_string()), None);
        assert!(result.is_ok());
        let results = result.unwrap();
        
        // Should find the README.md file
        assert!(!results.is_empty());
        let file_result = results.iter().find(|r| r.result_type == "file");
        assert!(file_result.is_some());
        
        let file_result = file_result.unwrap();
        assert_eq!(file_result.result_type, "file");
        assert!(file_result.file_path.is_some());
        assert!(file_result.file_path.as_ref().unwrap().contains("README"));
    }

    #[test]
    fn test_global_search_file_content() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path();

        // Add a file with specific content
        fs::write(repo_path.join("test.txt"), "This is a test file with specific content").expect("Failed to create test file");
        Command::new("git")
            .args(&["add", "test.txt"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to add test file");
        Command::new("git")
            .args(&["commit", "-m", "Add test file"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to commit test file");

        let result = global_search(repo_path.to_string_lossy().to_string(), "specific".to_string(), Some("main".to_string()), None);
        assert!(result.is_ok());
        let results = result.unwrap();
        
        // Should find the content in the test file
        assert!(!results.is_empty());
        let content_result = results.iter().find(|r| r.result_type == "content");
        assert!(content_result.is_some());
        
        let content_result = content_result.unwrap();
        assert_eq!(content_result.result_type, "content");
        assert!(content_result.file_path.is_some());
        assert_eq!(content_result.file_path.as_ref().unwrap(), "test.txt");
        assert!(content_result.content_preview.is_some());
        assert!(content_result.content_preview.as_ref().unwrap().to_lowercase().contains("specific"));
        assert!(content_result.line_number.is_some());
    }

    #[test]
    fn test_global_search_case_insensitive() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path().to_string_lossy().to_string();

        // Test case insensitive search for commit message
        let result = global_search(repo_path.clone(), "INITIAL".to_string(), Some("main".to_string()), None);
        assert!(result.is_ok());
        let results = result.unwrap();
        
        assert!(!results.is_empty());
        let commit_result = results.iter().find(|r| r.result_type == "commit");
        assert!(commit_result.is_some());
    }

    #[test]
    fn test_global_search_no_results() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path().to_string_lossy().to_string();

        let result = global_search(repo_path, "nonexistentstring123".to_string(), Some("main".to_string()), None);
        assert!(result.is_ok());
        let results = result.unwrap();
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_global_search_invalid_repository() {
        let result = global_search("/invalid/path".to_string(), "test".to_string(), Some("main".to_string()), None);
        assert!(result.is_err());
    }

    #[test]
    fn test_global_search_invalid_branch() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path().to_string_lossy().to_string();

        // Should still work by falling back to HEAD
        let result = global_search(repo_path, "Initial".to_string(), Some("nonexistent-branch".to_string()), None);
        assert!(result.is_ok());
        let results = result.unwrap();
        assert!(!results.is_empty());
    }

    #[test]
    fn test_global_search_multiple_commits() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path();

        // Add multiple commits with searchable content
        for i in 1..=3 {
            let filename = format!("file{}.txt", i);
            let content = format!("Content for file {} with keyword searchable", i);
            fs::write(repo_path.join(&filename), content).expect("Failed to create file");
            
            Command::new("git")
                .args(&["add", &filename])
                .current_dir(repo_path)
                .output()
                .expect("Failed to add file");
            
            Command::new("git")
                .args(&["commit", "-m", &format!("Add {} with searchable content", filename)])
                .current_dir(repo_path)
                .output()
                .expect("Failed to commit file");
        }

        let result = global_search(repo_path.to_string_lossy().to_string(), "searchable".to_string(), Some("main".to_string()), None);
        assert!(result.is_ok());
        let results = result.unwrap();
        
        // Should find results in commit messages and file content
        assert!(results.len() >= 3); // At least 3 results from commits
        
        let commit_results: Vec<_> = results.iter().filter(|r| r.result_type == "commit").collect();
        let content_results: Vec<_> = results.iter().filter(|r| r.result_type == "content").collect();
        
        assert!(commit_results.len() >= 3);
        assert!(content_results.len() >= 3);
    }

    #[test]
    fn test_global_search_result_limit() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path();

        // Add many commits to test result limiting - use unique search term
        for i in 1..=30 {
            let filename = format!("limitfile{}.txt", i);
            fs::write(repo_path.join(&filename), "uniquelimitsearch content").expect("Failed to create file");
            
            Command::new("git")
                .args(&["add", &filename])
                .current_dir(repo_path)
                .output()
                .expect("Failed to add file");
            
            Command::new("git")
                .args(&["commit", "-m", "uniquelimitsearch commit"])
                .current_dir(repo_path)
                .output()
                .expect("Failed to commit file");
        }

        let result = global_search(repo_path.to_string_lossy().to_string(), "uniquelimitsearch".to_string(), Some("main".to_string()), None);
        assert!(result.is_ok());
        let results = result.unwrap();
        
        // Should be limited to MAX_RESULTS (50) and stop early due to MAX_COMMITS (100)
        assert!(results.len() <= 50);
        assert!(results.len() > 10); // Should find many results
        
        // Verify we get both commit and content results
        let commit_results: Vec<_> = results.iter().filter(|r| r.result_type == "commit").collect();
        let content_results: Vec<_> = results.iter().filter(|r| r.result_type == "content").collect();
        
        assert!(!commit_results.is_empty());
        assert!(!content_results.is_empty());
    }

    #[test]
    fn test_global_search_filters_merge_commits() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path();

        // Create a feature branch
        Command::new("git")
            .args(&["checkout", "-b", "feature"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to create feature branch");

        // Add a commit with searchable content on feature branch
        fs::write(repo_path.join("feature.txt"), "mergetest content").expect("Failed to create feature file");
        Command::new("git")
            .args(&["add", "feature.txt"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to add feature file");
        Command::new("git")
            .args(&["commit", "-m", "mergetest feature commit"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to commit feature");

        // Switch back to main and create a merge commit
        Command::new("git")
            .args(&["checkout", "main"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to switch to main");

        Command::new("git")
            .args(&["merge", "feature", "-m", "mergetest merge commit"])
            .current_dir(repo_path)
            .output()
            .expect("Failed to merge feature branch");

        let result = global_search(repo_path.to_string_lossy().to_string(), "mergetest".to_string(), Some("main".to_string()), None);
        assert!(result.is_ok());
        let results = result.unwrap();
        
        // Should find results but exclude merge commits
        assert!(!results.is_empty());
        
        let commit_results: Vec<_> = results.iter().filter(|r| r.result_type == "commit").collect();
        
        // Should find the feature commit but not the merge commit
        // (The exact count depends on how git handles the merge, but we should find at least one commit)
        assert!(!commit_results.is_empty());
        
        // Verify that we don't find any commit messages containing "merge commit"
        let has_merge_commit = commit_results.iter().any(|r| r.commit_message.contains("merge commit"));
        assert!(!has_merge_commit, "Should not find merge commit in results");
        
        // Should find the feature commit
        let has_feature_commit = commit_results.iter().any(|r| r.commit_message.contains("feature commit"));
        assert!(has_feature_commit, "Should find the feature commit in results");
    }

    #[test]
    fn test_global_search_custom_limit() {
        let temp_repo = create_test_git_repo();
        let repo_path = temp_repo.path();

        // Add 5 commits with searchable content
        for i in 1..=5 {
            let filename = format!("limitfile{}.txt", i);
            fs::write(repo_path.join(&filename), "customlimit content").expect("Failed to create file");
            Command::new("git")
                .args(&["add", &filename])
                .current_dir(repo_path)
                .output()
                .expect("Failed to add file");
            Command::new("git")
                .args(&["commit", "-m", "customlimit commit"])
                .current_dir(repo_path)
                .output()
                .expect("Failed to commit file");
        }

        // Test with limit of 3 commits
        let result = global_search(repo_path.to_string_lossy().to_string(), "customlimit".to_string(), Some("main".to_string()), Some(3));
        assert!(result.is_ok());
        let results = result.unwrap();
        
        // Should find some results but limited by the commit count
        assert!(!results.is_empty());
        
        // Test with unlimited (None should use default 100)
        let result_unlimited = global_search(repo_path.to_string_lossy().to_string(), "customlimit".to_string(), Some("main".to_string()), None);
        assert!(result_unlimited.is_ok());
        let results_unlimited = result_unlimited.unwrap();
        
        // Should find all results since we're within the default limit
        assert!(!results_unlimited.is_empty());
    }
}
