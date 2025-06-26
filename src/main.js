import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';

let currentRepoPath = null;
let currentBranch = null;
let selectedCommit = null;
let selectedFile = null;

async function loadGitBranches(repoPath = null) {
    try {
        let branches;
        if (repoPath) {
            branches = await invoke('get_git_branches_from_path', { path: repoPath });
        } else {
            branches = await invoke('get_git_branches');
        }
        displayBranches(branches);
    } catch (error) {
        console.error('Error loading git branches:', error);
        const branchSelector = document.getElementById('branch-selector');
        if (branchSelector) {
            branchSelector.innerHTML = '<option value="">Error loading branches</option>';
        }
    }
}

function displayBranches(branches) {
    const branchSelector = document.getElementById('branch-selector');
    
    if (branches.length === 0) {
        branchSelector.innerHTML = '<option value="">No branches found</option>';
        return;
    }
    
    // Populate branch selector dropdown
    const branchOptions = branches.map(branch => 
        `<option value="${branch.name}" ${branch.is_current ? 'selected' : ''}>${branch.name}${branch.is_current ? ' (current)' : ''}</option>`
    ).join('');
    branchSelector.innerHTML = branchOptions;
    
    // Add change listener to branch selector (remove existing listeners first)
    const newBranchSelector = branchSelector.cloneNode(true);
    branchSelector.parentNode.replaceChild(newBranchSelector, branchSelector);
    
    newBranchSelector.addEventListener('change', (e) => {
        const selectedBranch = e.target.value;
        if (selectedBranch) {
            selectBranch(selectedBranch);
        }
    });
    
    // Automatically select current branch if available
    const currentBranchItem = branches.find(b => b.is_current);
    if (currentBranchItem && currentRepoPath) {
        selectBranch(currentBranchItem.name);
    }
}

async function selectBranch(branchName) {
    if (!currentRepoPath) return;
    
    currentBranch = branchName;
    
    // Update branch selector dropdown
    const branchSelector = document.getElementById('branch-selector');
    if (branchSelector) {
        branchSelector.value = branchName;
    }
    
    await loadCommits(branchName);
}

async function loadCommits(branchName) {
    if (!currentRepoPath) return;
    
    try {
        const commits = await invoke('get_commits_from_path', { 
            path: currentRepoPath, 
            branchName: branchName 
        });
        displayCommits(commits);
    } catch (error) {
        console.error('Error loading commits:', error);
        document.getElementById('commits').innerHTML = `<p style="padding: 15px; color: #dc3545;">Error: ${error}</p>`;
    }
}

function displayCommits(commits) {
    const commitsDiv = document.getElementById('commits');
    if (commits.length === 0) {
        commitsDiv.innerHTML = '<p style="padding: 15px; color: #666; font-style: italic;">No commits found</p>';
        return;
    }
    
    const commitList = commits.map(commit => 
        `<div class="commit-item" data-commit-id="${commit.id}">
            <div class="commit-message">${commit.message}</div>
            <div class="commit-meta">
                <span class="commit-id">${commit.short_id}</span>
                ${commit.author} • ${commit.date}
            </div>
        </div>`
    ).join('');
    
    commitsDiv.innerHTML = commitList;
    
    // Add click listeners to commits
    commitsDiv.querySelectorAll('.commit-item').forEach(commitItem => {
        commitItem.addEventListener('click', () => {
            const commitId = commitItem.dataset.commitId;
            selectCommit(commitId);
        });
    });
}

async function selectCommit(commitId) {
    if (!currentRepoPath) return;
    
    selectedCommit = commitId;
    
    // Update commit selection UI
    document.querySelectorAll('.commit-item').forEach(item => {
        item.classList.remove('selected');
    });
    document.querySelector(`[data-commit-id="${commitId}"]`)?.classList.add('selected');
    
    await loadFileChanges(commitId);
}

async function loadFileChanges(commitId) {
    if (!currentRepoPath) return;
    
    try {
        const changes = await invoke('get_commit_changes', { 
            path: currentRepoPath, 
            commitId: commitId 
        });
        displayFileChanges(changes);
    } catch (error) {
        console.error('Error loading file changes:', error);
        document.getElementById('file-changes').innerHTML = `<p style="padding: 15px; color: #dc3545;">Error: ${error}</p>`;
    }
}

function displayFileChanges(changes) {
    const changesDiv = document.getElementById('file-changes');
    if (changes.length === 0) {
        changesDiv.innerHTML = '<p style="padding: 15px; color: #666; font-style: italic;">No file changes found</p>';
        return;
    }
    
    const changesList = changes.map(change => 
        `<div class="file-item" data-file-path="${change.path}">
            <span class="file-status ${change.status}"></span>
            <span class="file-path">${change.path}</span>
        </div>`
    ).join('');
    
    changesDiv.innerHTML = changesList;
    
    // Add click listeners to files
    changesDiv.querySelectorAll('.file-item').forEach(fileItem => {
        fileItem.addEventListener('click', () => {
            const filePath = fileItem.dataset.filePath;
            selectFile(filePath);
        });
    });
}

async function selectFile(filePath) {
    if (!currentRepoPath || !selectedCommit) return;
    
    selectedFile = filePath;
    
    // Update file selection UI
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('selected');
    });
    document.querySelector(`[data-file-path="${filePath}"]`)?.classList.add('selected');
    
    await loadFileDiff(filePath);
}

async function loadFileDiff(filePath) {
    if (!currentRepoPath || !selectedCommit) return;
    
    try {
        const diff = await invoke('get_file_diff', { 
            path: currentRepoPath, 
            commitId: selectedCommit,
            filePath: filePath
        });
        displayFileDiff(diff);
    } catch (error) {
        console.error('Error loading file diff:', error);
        document.getElementById('file-diff').innerHTML = `<p style="padding: 15px; color: #dc3545;">Error: ${error}</p>`;
    }
}

function displayFileDiff(diff) {
    const diffDiv = document.getElementById('file-diff');
    
    if (diff.is_binary) {
        diffDiv.innerHTML = `
            <div class="diff-header">${diff.path} (${diff.status})</div>
            <div class="binary-file">Binary file - cannot display diff</div>
        `;
        return;
    }
    
    if (diff.diff_lines.length === 0) {
        diffDiv.innerHTML = `
            <div class="diff-header">${diff.path} (${diff.status})</div>
            <p style="padding: 15px; color: #666; font-style: italic;">No changes to display</p>
        `;
        return;
    }
    
    const diffContent = diff.diff_lines.map(line => {
        const oldLineNum = line.old_line_number ? line.old_line_number.toString() : '';
        const newLineNum = line.new_line_number ? line.new_line_number.toString() : '';
        const lineNumbers = `${oldLineNum} ${newLineNum}`.trim() || ' ';
        
        return `
            <div class="diff-line ${line.line_type}">
                <div class="line-numbers">${lineNumbers}</div>
                <div class="line-content">${escapeHtml(line.content)}</div>
            </div>
        `;
    }).join('');
    
    diffDiv.innerHTML = `
        <div class="diff-header">${diff.path} (${diff.status})</div>
        ${diffContent}
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateRepositoryName(repoPath) {
    const repoNameElement = document.getElementById('repo-name');
    if (repoPath) {
        // Extract just the folder name from the full path
        const repoName = repoPath.split('/').pop() || repoPath;
        repoNameElement.textContent = repoName;
    } else {
        repoNameElement.textContent = '';
    }
}

async function openRepository() {
    try {
        const selected = await open({
            directory: true,
            title: 'Select Git Repository Folder'
        });
        
        if (selected) {
            currentRepoPath = selected;
            updateRepositoryName(selected);
            await loadGitBranches(selected);
        }
    } catch (error) {
        console.error('Error opening repository:', error);
        const branchSelector = document.getElementById('branch-selector');
        if (branchSelector) {
            branchSelector.innerHTML = '<option value="">Error loading repository</option>';
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const appWindow = getCurrentWindow();
    
    // Listen for menu events
    await appWindow.listen('menu-open-repo', () => {
        openRepository();
    });
    
    loadGitBranches();
});