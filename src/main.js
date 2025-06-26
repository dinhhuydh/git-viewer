import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

let currentRepoPath = null;

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
        document.getElementById('branches').innerHTML = `<p>Error: ${error}</p>`;
    }
}

function displayBranches(branches) {
    const branchesDiv = document.getElementById('branches');
    if (branches.length === 0) {
        branchesDiv.innerHTML = '<p>No branches found</p>';
        return;
    }
    
    const branchList = branches.map(branch => 
        `<li class="${branch.is_current ? 'current-branch' : ''}">${branch.name} ${branch.is_current ? '(current)' : ''}</li>`
    ).join('');
    
    branchesDiv.innerHTML = `<ul>${branchList}</ul>`;
}

async function openRepository() {
    try {
        const selected = await open({
            directory: true,
            title: 'Select Git Repository Folder'
        });
        
        if (selected) {
            currentRepoPath = selected;
            document.getElementById('current-repo-path').textContent = selected;
            await loadGitBranches(selected);
        }
    } catch (error) {
        console.error('Error opening repository:', error);
        document.getElementById('branches').innerHTML = `<p>Error: ${error}</p>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('open-repo-btn').addEventListener('click', openRepository);
    loadGitBranches();
});