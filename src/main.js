import { invoke } from '@tauri-apps/api/core';

async function loadGitBranches() {
    try {
        const branches = await invoke('get_git_branches');
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

document.addEventListener('DOMContentLoaded', () => {
    loadGitBranches();
});