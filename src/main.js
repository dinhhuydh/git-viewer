import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';

let currentRepoPath = null;
let currentBranch = null;
let selectedCommit = null;
let selectedFile = null;

// Recent repositories management
const RECENT_REPOS_KEY = 'git-viewer-recent-repos';
const MAX_RECENT_REPOS = 10;

// Panel resizing
const FILE_PANEL_WIDTH_KEY = 'git-viewer-file-panel-width';
const COMMITS_SIDEBAR_WIDTH_KEY = 'git-viewer-commits-sidebar-width';
let isResizing = false;

// File navigation
let currentFileIndex = -1;
let fileItems = [];

// Commit navigation
let currentCommitIndex = -1;
let commitItems = [];

// File filtering
let allFileItems = [];
let filteredFileItems = [];

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
        commitItems = [];
        currentCommitIndex = -1;
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
    
    // Update commit items array for keyboard navigation
    commitItems = Array.from(commitsDiv.querySelectorAll('.commit-item'));
    currentCommitIndex = -1;
    
    // Add click listeners to commits
    commitItems.forEach((commitItem, index) => {
        commitItem.addEventListener('click', () => {
            const commitId = commitItem.dataset.commitId;
            currentCommitIndex = index;
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
    const selectedElement = document.querySelector(`[data-commit-id="${commitId}"]`);
    if (selectedElement) {
        selectedElement.classList.add('selected');
        
        // Update current commit index if not already set by keyboard navigation
        const index = commitItems.indexOf(selectedElement);
        if (index !== -1) {
            currentCommitIndex = index;
        }
    }
    
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
        allFileItems = [];
        filteredFileItems = [];
        fileItems = [];
        currentFileIndex = -1;
        // Clear diff panel when no files
        document.getElementById('file-diff').innerHTML = '<p style="padding: 15px; color: #666; font-style: italic;">Select a file to view changes</p>';
        // Clear filter
        document.getElementById('file-filter').value = '';
        return;
    }
    
    const changesList = changes.map(change => 
        `<div class="file-item" data-file-path="${change.path}">
            <span class="file-status ${change.status}"></span>
            <span class="file-path">${change.path}</span>
        </div>`
    ).join('');
    
    changesDiv.innerHTML = changesList;
    
    // Update file items arrays
    allFileItems = Array.from(changesDiv.querySelectorAll('.file-item'));
    filteredFileItems = [...allFileItems];
    fileItems = [...allFileItems];
    currentFileIndex = -1;
    
    // Add click listeners to files
    allFileItems.forEach((fileItem, index) => {
        fileItem.addEventListener('click', () => {
            const filePath = fileItem.dataset.filePath;
            // Find index in filtered results for proper navigation
            currentFileIndex = filteredFileItems.indexOf(fileItem);
            selectFile(filePath);
        });
    });
    
    // Clear filter and auto-select first file if available
    document.getElementById('file-filter').value = '';
    if (fileItems.length > 0) {
        const firstFilePath = fileItems[0].dataset.filePath;
        currentFileIndex = 0;
        fileItems[0].classList.add('selected');
        selectFile(firstFilePath);
    }
}

async function selectFile(filePath) {
    if (!currentRepoPath || !selectedCommit) return;
    
    selectedFile = filePath;
    
    // Update file selection UI
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('selected');
    });
    const selectedElement = document.querySelector(`[data-file-path="${filePath}"]`);
    if (selectedElement) {
        selectedElement.classList.add('selected');
        
        // Update current file index if not already set by keyboard navigation
        const index = fileItems.indexOf(selectedElement);
        if (index !== -1) {
            currentFileIndex = index;
        }
    }
    
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

function getRecentRepositories() {
    try {
        const stored = localStorage.getItem(RECENT_REPOS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        console.error('Error loading recent repositories:', error);
        return [];
    }
}

function saveRecentRepositories(repos) {
    try {
        localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(repos));
    } catch (error) {
        console.error('Error saving recent repositories:', error);
    }
}

function addToRecentRepositories(repoPath) {
    let recentRepos = getRecentRepositories();
    
    // Remove if already exists to avoid duplicates
    recentRepos = recentRepos.filter(repo => repo.path !== repoPath);
    
    // Add to beginning
    const repoName = repoPath.split('/').pop() || repoPath;
    recentRepos.unshift({
        path: repoPath,
        name: repoName,
        lastOpened: new Date().toISOString()
    });
    
    // Keep only MAX_RECENT_REPOS
    if (recentRepos.length > MAX_RECENT_REPOS) {
        recentRepos = recentRepos.slice(0, MAX_RECENT_REPOS);
    }
    
    saveRecentRepositories(recentRepos);
    updateRecentRepositoriesMenu();
}

function updateRecentRepositoriesMenu() {
    const menu = document.getElementById('recent-repos-menu');
    const recentRepos = getRecentRepositories();
    
    if (recentRepos.length === 0) {
        menu.innerHTML = '<div class="no-recent-repos">No recent repositories</div>';
        return;
    }
    
    const menuItems = recentRepos.map(repo => `
        <div class="recent-repo-item" data-repo-path="${repo.path}">
            <div class="recent-repo-name">${repo.name}</div>
            <div class="recent-repo-path">${repo.path}</div>
        </div>
    `).join('');
    
    menu.innerHTML = menuItems;
    
    // Add click listeners
    menu.querySelectorAll('.recent-repo-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            const repoPath = e.currentTarget.dataset.repoPath;
            await openRepository(repoPath);
            hideRecentRepositoriesMenu();
        });
    });
}

function showRecentRepositoriesMenu() {
    const menu = document.getElementById('recent-repos-menu');
    menu.classList.add('show');
}

function hideRecentRepositoriesMenu() {
    const menu = document.getElementById('recent-repos-menu');
    menu.classList.remove('show');
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

async function openRepository(repoPath = null) {
    try {
        let selected = repoPath;
        
        if (!selected) {
            selected = await open({
                directory: true,
                title: 'Select Git Repository Folder'
            });
        }
        
        if (selected) {
            currentRepoPath = selected;
            updateRepositoryName(selected);
            addToRecentRepositories(selected);
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

function filterFiles(filterText) {
    const filterLower = filterText.toLowerCase();
    
    // Reset all files visibility
    allFileItems.forEach(item => {
        item.classList.remove('hidden');
    });
    
    if (filterText.trim() === '') {
        // Show all files
        filteredFileItems = [...allFileItems];
        fileItems = [...allFileItems];
    } else {
        // Filter files based on path
        filteredFileItems = allFileItems.filter(item => {
            const filePath = item.dataset.filePath.toLowerCase();
            const matches = filePath.includes(filterLower);
            if (!matches) {
                item.classList.add('hidden');
            }
            return matches;
        });
        fileItems = [...filteredFileItems];
    }
    
    // Reset selection
    allFileItems.forEach(item => item.classList.remove('selected'));
    currentFileIndex = -1;
    
    // Auto-select first visible file
    if (filteredFileItems.length > 0) {
        const firstFilePath = filteredFileItems[0].dataset.filePath;
        currentFileIndex = 0;
        filteredFileItems[0].classList.add('selected');
        selectFile(firstFilePath);
    } else {
        // No matches, clear diff panel
        document.getElementById('file-diff').innerHTML = '<p style="padding: 15px; color: #666; font-style: italic;">No files match the filter</p>';
    }
}

function navigateToFileIndex(index) {
    if (fileItems.length === 0 || index < 0 || index >= fileItems.length) {
        return;
    }
    
    currentFileIndex = index;
    const fileItem = fileItems[index];
    const filePath = fileItem.dataset.filePath;
    
    // Update selection UI (only on visible files)
    allFileItems.forEach(item => item.classList.remove('selected'));
    fileItem.classList.add('selected');
    
    // Scroll into view if needed
    fileItem.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'nearest',
        inline: 'nearest'
    });
    
    // Select the file
    selectFile(filePath);
}

function handleFileNavigation(direction) {
    if (fileItems.length === 0) return;
    
    let newIndex;
    
    switch (direction) {
        case 'up':
        case 'left':
            newIndex = currentFileIndex <= 0 ? fileItems.length - 1 : currentFileIndex - 1;
            break;
        case 'down':
        case 'right':
            newIndex = currentFileIndex >= fileItems.length - 1 ? 0 : currentFileIndex + 1;
            break;
        case 'home':
            newIndex = 0;
            break;
        case 'end':
            newIndex = fileItems.length - 1;
            break;
        default:
            return;
    }
    
    navigateToFileIndex(newIndex);
}

function navigateToCommitIndex(index) {
    if (commitItems.length === 0 || index < 0 || index >= commitItems.length) {
        return;
    }
    
    currentCommitIndex = index;
    const commitItem = commitItems[index];
    const commitId = commitItem.dataset.commitId;
    
    // Update selection UI
    commitItems.forEach(item => item.classList.remove('selected'));
    commitItem.classList.add('selected');
    
    // Scroll into view if needed
    commitItem.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'nearest',
        inline: 'nearest'
    });
    
    // Select the commit
    selectCommit(commitId);
}

function handleCommitNavigation(direction) {
    if (commitItems.length === 0) return;
    
    let newIndex;
    
    switch (direction) {
        case 'up':
        case 'left':
            newIndex = currentCommitIndex <= 0 ? commitItems.length - 1 : currentCommitIndex - 1;
            break;
        case 'down':
        case 'right':
            newIndex = currentCommitIndex >= commitItems.length - 1 ? 0 : currentCommitIndex + 1;
            break;
        case 'home':
            newIndex = 0;
            break;
        case 'end':
            newIndex = commitItems.length - 1;
            break;
        default:
            return;
    }
    
    navigateToCommitIndex(newIndex);
}

function initializeCommitKeyboardNavigation() {
    const commitsSidebar = document.getElementById('commits-sidebar');
    
    commitsSidebar.addEventListener('keydown', (e) => {
        // Only handle navigation if the commits sidebar is focused and we have commits
        if (document.activeElement !== commitsSidebar || commitItems.length === 0) {
            return;
        }
        
        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                handleCommitNavigation('up');
                break;
            case 'ArrowDown':
                e.preventDefault();
                handleCommitNavigation('down');
                break;
            case 'ArrowLeft':
                e.preventDefault();
                handleCommitNavigation('left');
                break;
            case 'ArrowRight':
                e.preventDefault();
                handleCommitNavigation('right');
                break;
            case 'Home':
                e.preventDefault();
                handleCommitNavigation('home');
                break;
            case 'End':
                e.preventDefault();
                handleCommitNavigation('end');
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (currentCommitIndex >= 0 && currentCommitIndex < commitItems.length) {
                    const commitId = commitItems[currentCommitIndex].dataset.commitId;
                    selectCommit(commitId);
                }
                break;
        }
    });
    
    // Focus commits sidebar when clicking on it
    commitsSidebar.addEventListener('click', (e) => {
        // Don't focus if clicking on branch selector
        if (!e.target.closest('.branch-selector')) {
            commitsSidebar.focus();
        }
    });
}

function initializeFileFiltering() {
    const filterInput = document.getElementById('file-filter');
    
    // Real-time filtering as user types
    filterInput.addEventListener('input', (e) => {
        filterFiles(e.target.value);
    });
    
    // Clear filter with Escape key
    filterInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            filterInput.value = '';
            filterFiles('');
            filterInput.blur();
        }
    });
}

function initializeFileKeyboardNavigation() {
    const filePanel = document.getElementById('file-panel');
    const filterInput = document.getElementById('file-filter');
    
    filePanel.addEventListener('keydown', (e) => {
        // Don't handle navigation if filter input is focused
        if (document.activeElement === filterInput) {
            return;
        }
        
        // Only handle navigation if the file panel is focused and we have files
        if (document.activeElement !== filePanel || fileItems.length === 0) {
            return;
        }
        
        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                handleFileNavigation('up');
                break;
            case 'ArrowDown':
                e.preventDefault();
                handleFileNavigation('down');
                break;
            case 'ArrowLeft':
                e.preventDefault();
                handleFileNavigation('left');
                break;
            case 'ArrowRight':
                e.preventDefault();
                handleFileNavigation('right');
                break;
            case 'Home':
                e.preventDefault();
                handleFileNavigation('home');
                break;
            case 'End':
                e.preventDefault();
                handleFileNavigation('end');
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (currentFileIndex >= 0 && currentFileIndex < fileItems.length) {
                    const filePath = fileItems[currentFileIndex].dataset.filePath;
                    selectFile(filePath);
                }
                break;
            case '/':
            case 'f':
                // Focus filter input with / or f key
                e.preventDefault();
                filterInput.focus();
                break;
        }
    });
    
    // Focus file panel when clicking on it
    filePanel.addEventListener('click', (e) => {
        // Don't focus if clicking on resize handles or filter input
        if (!e.target.classList.contains('resize-handle') && e.target !== filterInput) {
            filePanel.focus();
        }
    });
}

function initializePanelResizing() {
    // Initialize file panel resizing
    initializeFilePanelResizing();
    
    // Initialize commits sidebar resizing
    initializeCommitsSidebarResizing();
}

function initializeFilePanelResizing() {
    const filePanel = document.getElementById('file-panel');
    const rightResizeHandle = document.getElementById('file-panel-resize-right');
    
    // Load saved width
    const savedWidth = localStorage.getItem(FILE_PANEL_WIDTH_KEY);
    if (savedWidth) {
        filePanel.style.width = savedWidth + 'px';
    }
    
    let startX = 0;
    let startWidth = 0;
    let isFilePanelResizing = false;
    
    // Right handle (resize from right edge)
    rightResizeHandle.addEventListener('mousedown', (e) => {
        isFilePanelResizing = true;
        isResizing = true;
        startX = e.clientX;
        startWidth = parseInt(document.defaultView.getComputedStyle(filePanel).width, 10);
        
        rightResizeHandle.classList.add('dragging');
        document.body.classList.add('resizing');
        
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isFilePanelResizing) return;
        
        // Right handle: dragging right increases width, dragging left decreases width
        const width = startWidth + (e.clientX - startX);
        const minWidth = 200;
        const maxWidth = 600;
        
        if (width >= minWidth && width <= maxWidth) {
            filePanel.style.width = width + 'px';
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isFilePanelResizing) {
            isFilePanelResizing = false;
            isResizing = false;
            rightResizeHandle.classList.remove('dragging');
            document.body.classList.remove('resizing');
            
            // Save the new width
            const currentWidth = parseInt(document.defaultView.getComputedStyle(filePanel).width, 10);
            localStorage.setItem(FILE_PANEL_WIDTH_KEY, currentWidth);
        }
    });
}

function initializeCommitsSidebarResizing() {
    const commitsSidebar = document.getElementById('commits-sidebar');
    const rightResizeHandle = document.getElementById('commits-sidebar-resize-right');
    
    // Load saved width
    const savedWidth = localStorage.getItem(COMMITS_SIDEBAR_WIDTH_KEY);
    if (savedWidth) {
        commitsSidebar.style.width = savedWidth + 'px';
    }
    
    let startX = 0;
    let startWidth = 0;
    let isCommitsSidebarResizing = false;
    
    // Right handle (resize from right edge)
    rightResizeHandle.addEventListener('mousedown', (e) => {
        isCommitsSidebarResizing = true;
        isResizing = true;
        startX = e.clientX;
        startWidth = parseInt(document.defaultView.getComputedStyle(commitsSidebar).width, 10);
        
        rightResizeHandle.classList.add('dragging');
        document.body.classList.add('resizing');
        
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isCommitsSidebarResizing) return;
        
        // Right handle: dragging right increases width, dragging left decreases width
        const width = startWidth + (e.clientX - startX);
        const minWidth = 200;
        const maxWidth = 600;
        
        if (width >= minWidth && width <= maxWidth) {
            commitsSidebar.style.width = width + 'px';
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isCommitsSidebarResizing) {
            isCommitsSidebarResizing = false;
            isResizing = false;
            rightResizeHandle.classList.remove('dragging');
            document.body.classList.remove('resizing');
            
            // Save the new width
            const currentWidth = parseInt(document.defaultView.getComputedStyle(commitsSidebar).width, 10);
            localStorage.setItem(COMMITS_SIDEBAR_WIDTH_KEY, currentWidth);
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const appWindow = getCurrentWindow();
    
    // Listen for menu events
    await appWindow.listen('menu-open-repo', () => {
        openRepository();
    });
    
    // Setup recent repositories dropdown
    const recentReposButton = document.getElementById('recent-repos-button');
    const recentReposMenu = document.getElementById('recent-repos-menu');
    
    recentReposButton.addEventListener('click', (e) => {
        e.stopPropagation();
        if (recentReposMenu.classList.contains('show')) {
            hideRecentRepositoriesMenu();
        } else {
            showRecentRepositoriesMenu();
        }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!recentReposButton.contains(e.target) && !recentReposMenu.contains(e.target)) {
            hideRecentRepositoriesMenu();
        }
    });
    
    // Initialize recent repositories menu
    updateRecentRepositoriesMenu();
    
    // Initialize panel resizing
    initializePanelResizing();
    
    // Initialize file keyboard navigation
    initializeFileKeyboardNavigation();
    
    // Initialize commit keyboard navigation
    initializeCommitKeyboardNavigation();
    
    // Initialize file filtering
    initializeFileFiltering();
    
    loadGitBranches();
});