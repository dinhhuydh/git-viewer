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
