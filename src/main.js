import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';

let currentRepoPath = null;
let currentBranch = null;
let selectedCommit = null;
let selectedFile = null;

// Recent repositories management
const RECENT_REPOS_KEY = 'git-viewer-recent-repos';
const LAST_REPO_KEY = 'git-viewer-last-repo';
const MAX_RECENT_REPOS = 10;

// Search settings
const SEARCH_LIMIT_KEY = 'git-viewer-search-limit';
const DEFAULT_SEARCH_LIMIT = 100;

// Blame cache
const blameCache = new Map();
const MAX_CACHE_SIZE = 50; // Maximum number of blame results to cache

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

// Global search
let searchTimeout = null;
let isSearching = false;

// Blame view
let currentViewMode = 'diff'; // 'diff' or 'blame'
let currentBlameData = null;

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
    
    // Clear any external commit indicator
    removeExternalCommitIndicator();
    
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
    
    // Add dedicated click listeners to commit hash elements
    commitItems.forEach((commitItem) => {
        const commitHashElement = commitItem.querySelector('.commit-id');
        if (commitHashElement) {
            commitHashElement.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                copyCommitHashToClipboard(commitItem.dataset.commitId, commitHashElement);
            });
        }
    });
    
    // Auto-select first commit if available
    if (commitItems.length > 0) {
        const firstCommitId = commitItems[0].dataset.commitId;
        currentCommitIndex = 0;
        selectCommit(firstCommitId);
    }
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
        
        // Scroll the selected commit into view
        selectedElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'nearest',
            inline: 'nearest'
        });
        
        // Remove any "external commit" indicator
        removeExternalCommitIndicator();
    } else {
        // Commit not in current view - show indicator
        showExternalCommitIndicator(commitId);
        // Reset navigation index since commit isn't in current list
        currentCommitIndex = -1;
    }
    
    // Update the file panel header to show current commit
    updateFilePanelHeader(commitId);
    
    await loadFileChanges(commitId);
}

function updateFilePanelHeader(commitId) {
    const header = document.querySelector('.panel-header-with-filter');
    if (header) {
        const shortId = commitId.substring(0, 8);
        header.innerHTML = `
            File Changes <small style="color: #666;">(${shortId})</small>
            <input type="text" class="filter-input" id="file-filter" placeholder="Filter files..." />
        `;
        
        // Reinitialize file filtering since we replaced the input
        const filterInput = document.getElementById('file-filter');
        filterInput.addEventListener('input', (e) => {
            filterFiles(e.target.value);
        });
        filterInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                filterInput.value = '';
                filterFiles('');
                filterInput.blur();
            }
        });
    }
}

function showExternalCommitIndicator(commitId) {
    const commitsDiv = document.getElementById('commits');
    
    // Remove existing indicator if any
    removeExternalCommitIndicator();
    
    // Create indicator element
    const indicator = document.createElement('div');
    indicator.id = 'external-commit-indicator';
    indicator.style.cssText = `
        background-color: #d1ecf1;
        border: 2px solid #007acc;
        color: #0c5460;
        padding: 12px 15px;
        margin: 8px;
        border-radius: 6px;
        font-size: 13px;
        text-align: center;
        font-weight: bold;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    `;
    indicator.innerHTML = `📍 Viewing commit ${commitId.substring(0, 8)} (not in current list)`;
    
    // Insert at the top of commits div
    commitsDiv.insertBefore(indicator, commitsDiv.firstChild);
}

function removeExternalCommitIndicator() {
    const indicator = document.getElementById('external-commit-indicator');
    if (indicator) {
        indicator.remove();
    }
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
    
    await loadFileView(filePath);
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

async function loadFileView(filePath) {
    if (!currentRepoPath || !selectedCommit) return;
    
    // Update view toggle buttons state
    updateViewToggleButtons();
    
    if (currentViewMode === 'diff') {
        await loadFileDiff(filePath);
    } else {
        await loadFileBlame(filePath);
    }
}

async function loadFileBlame(filePath) {
    if (!currentRepoPath || !selectedCommit) return;
    
    const diffDiv = document.getElementById('file-diff');
    
    // Check cache first
    const cacheKey = `${currentRepoPath}:${selectedCommit}:${filePath}`;
    if (blameCache.has(cacheKey)) {
        const cachedBlame = blameCache.get(cacheKey);
        currentBlameData = cachedBlame;
        displayFileBlame(cachedBlame);
        return;
    }
    
    // Show loading indicator
    diffDiv.innerHTML = `
        <div class="diff-header">Loading blame for ${filePath}...</div>
        <div style="padding: 20px; text-align: center;">
            <div class="loading-spinner"></div>
            <p style="margin-top: 10px; color: #666;">Analyzing file history...</p>
        </div>
    `;
    
    try {
        const blame = await invoke('get_file_blame', {
            path: currentRepoPath,
            commitId: selectedCommit,
            filePath: filePath
        });
        
        // Cache the result
        cacheBlameResult(cacheKey, blame);
        
        currentBlameData = blame;
        displayFileBlame(blame);
    } catch (error) {
        console.error('Error loading file blame:', error);
        diffDiv.innerHTML = `<p style="padding: 15px; color: #dc3545;">Error: ${error}</p>`;
    }
}

function cacheBlameResult(cacheKey, blame) {
    // Remove oldest entries if cache is full
    if (blameCache.size >= MAX_CACHE_SIZE) {
        const firstKey = blameCache.keys().next().value;
        blameCache.delete(firstKey);
    }
    
    // Add new entry
    blameCache.set(cacheKey, blame);
}

function displayFileBlame(blame) {
    const diffDiv = document.getElementById('file-diff');
    
    if (blame.blame_lines.length === 0) {
        diffDiv.innerHTML = `
            <div class="diff-header">${blame.path} (blame)</div>
            <p style="padding: 15px; color: #666; font-style: italic;">No content to display</p>
        `;
        return;
    }
    
    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    
    // Create header
    const header = document.createElement('div');
    header.className = 'diff-header';
    header.textContent = `${blame.path} (blame)`;
    fragment.appendChild(header);
    
    // Create blame lines efficiently
    blame.blame_lines.forEach(line => {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'blame-line';
        
        // Create blame info
        const blameInfo = document.createElement('div');
        blameInfo.className = 'blame-info';
        
        const blameCommit = document.createElement('div');
        blameCommit.className = 'blame-commit';
        
        const commitHash = document.createElement('span');
        commitHash.className = 'blame-commit-hash';
        commitHash.dataset.commitId = line.commit_id;
        commitHash.textContent = line.commit_short_id;
        commitHash.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            copyCommitHashToClipboard(line.commit_id, commitHash);
        });
        
        const author = document.createElement('span');
        author.className = 'blame-author';
        author.textContent = line.author;
        
        const blameDate = document.createElement('span');
        blameDate.className = 'blame-date';
        blameDate.textContent = line.date;
        
        blameCommit.appendChild(commitHash);
        blameCommit.appendChild(author);
        blameCommit.appendChild(blameDate);
        
        blameInfo.appendChild(blameCommit);
        
        // Create line number
        const lineNumber = document.createElement('div');
        lineNumber.className = 'blame-line-number';
        lineNumber.textContent = line.line_number;
        
        // Create content
        const content = document.createElement('div');
        content.className = 'blame-content';
        content.textContent = line.content;
        
        lineDiv.appendChild(blameInfo);
        lineDiv.appendChild(lineNumber);
        lineDiv.appendChild(content);
        
        fragment.appendChild(lineDiv);
    });
    
    // Replace content efficiently
    diffDiv.innerHTML = '';
    diffDiv.appendChild(fragment);
}

function updateViewToggleButtons() {
    const diffBtn = document.getElementById('diff-view-btn');
    const blameBtn = document.getElementById('blame-view-btn');
    const panelTitle = document.getElementById('diff-panel-title');
    
    if (currentViewMode === 'diff') {
        diffBtn.classList.add('active');
        blameBtn.classList.remove('active');
        panelTitle.textContent = 'File Diff';
    } else {
        diffBtn.classList.remove('active');
        blameBtn.classList.add('active');
        panelTitle.textContent = 'Blame View';
    }
    
    // Disable blame button for files that can't be blamed
    if (!selectedFile) {
        blameBtn.disabled = true;
    } else {
        blameBtn.disabled = false;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getSearchLimit() {
    try {
        const stored = localStorage.getItem(SEARCH_LIMIT_KEY);
        if (stored) {
            const limit = parseInt(stored, 10);
            return limit >= 10 && limit <= 10000 ? limit : DEFAULT_SEARCH_LIMIT;
        }
        return DEFAULT_SEARCH_LIMIT;
    } catch (error) {
        console.error('Error loading search limit:', error);
        return DEFAULT_SEARCH_LIMIT;
    }
}

function setSearchLimit(limit) {
    try {
        const numLimit = parseInt(limit, 10);
        if (numLimit >= 10 && numLimit <= 10000) {
            localStorage.setItem(SEARCH_LIMIT_KEY, numLimit.toString());
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error saving search limit:', error);
        return false;
    }
}

function showSearchSettings() {
    const settingsOverlay = document.getElementById('search-settings-overlay');
    const searchInput = document.getElementById('search-limit-input');
    
    // Load current setting
    searchInput.value = getSearchLimit();
    
    // Hide search results if open
    hideSearchResults();
    
    // Show settings overlay
    settingsOverlay.classList.add('show');
}

function hideSearchSettings() {
    const settingsOverlay = document.getElementById('search-settings-overlay');
    settingsOverlay.classList.remove('show');
}

function initializeBlameView() {
    const diffBtn = document.getElementById('diff-view-btn');
    const blameBtn = document.getElementById('blame-view-btn');
    
    diffBtn.addEventListener('click', () => {
        if (currentViewMode !== 'diff') {
            currentViewMode = 'diff';
            if (selectedFile) {
                loadFileView(selectedFile);
            }
        }
    });
    
    blameBtn.addEventListener('click', () => {
        if (currentViewMode !== 'blame') {
            currentViewMode = 'blame';
            if (selectedFile) {
                loadFileView(selectedFile);
            }
        }
    });
    
    // Initialize view toggle state
    updateViewToggleButtons();
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
            
            // Save as last opened repository
            localStorage.setItem(LAST_REPO_KEY, selected);
            
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

async function performGlobalSearch(query) {
    if (!currentRepoPath || query.trim().length < 2) {
        hideSearchResults();
        return;
    }
    
    isSearching = true;
    const searchOverlay = document.getElementById('search-results-overlay');
    
    try {
        const maxCommits = getSearchLimit();
        const results = await invoke('global_search', {
            path: currentRepoPath,
            query: query.trim(),
            branchName: currentBranch,
            maxCommits: maxCommits
        });
        
        displaySearchResults(results, query);
    } catch (error) {
        console.error('Search error:', error);
        searchOverlay.innerHTML = '<div class="search-result-item"><div class="search-result-content">Search failed: ' + error + '</div></div>';
        searchOverlay.classList.add('show');
    } finally {
        isSearching = false;
    }
}

function displaySearchResults(results, query) {
    const searchOverlay = document.getElementById('search-results-overlay');
    
    if (results.length === 0) {
        searchOverlay.innerHTML = '<div class="search-result-item"><div class="search-result-content">No results found</div></div>';
        searchOverlay.classList.add('show');
        return;
    }
    
    const resultsHtml = results.map(result => {
        const typeLabel = {
            'commit': 'Commit Message',
            'file': 'File Name', 
            'content': 'File Content'
        }[result.result_type] || result.result_type;
        
        const title = result.result_type === 'commit' 
            ? result.commit_message
            : result.file_path || result.commit_message;
            
        const content = result.content_preview || '';
        const highlightedContent = highlightSearchTerm(content, query);
        const highlightedTitle = highlightSearchTerm(title, query);
        
        let lineInfo = '';
        if (result.line_number) {
            lineInfo = ` (line ${result.line_number})`;
        }
        
        // Build commit info for file and content results
        let commitInfo = '';
        if (result.result_type === 'file' || result.result_type === 'content') {
            const shortCommitId = result.commit_id.substring(0, 8);
            const commitMessage = result.commit_message.length > 50 
                ? result.commit_message.substring(0, 47) + '...'
                : result.commit_message;
            commitInfo = `<div class="search-result-commit-info">
                <span class="search-result-commit-hash">${shortCommitId}</span>${highlightSearchTerm(commitMessage, query)}
            </div>`;
        }
        
        return `
            <div class="search-result-item" data-commit-id="${result.commit_id}" data-file-path="${result.file_path || ''}" data-result-type="${result.result_type}">
                <div class="search-result-type">${typeLabel}${lineInfo}</div>
                <div class="search-result-title">${highlightedTitle}</div>
                <div class="search-result-content">
                    ${highlightedContent}
                    <br><small>${result.commit_author} • ${result.commit_date}</small>
                    ${commitInfo}
                </div>
            </div>
        `;
    }).join('');
    
    searchOverlay.innerHTML = resultsHtml;
    searchOverlay.classList.add('show');
    
    // Add click listeners to search results
    searchOverlay.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            const commitId = item.dataset.commitId;
            const filePath = item.dataset.filePath;
            const resultType = item.dataset.resultType;
            
            handleSearchResultClick(commitId, filePath, resultType);
            hideSearchResults();
        });
    });
    
    // Add dedicated click listeners to search result commit hash elements
    searchOverlay.querySelectorAll('.search-result-commit-hash').forEach(hashElement => {
        hashElement.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const resultItem = hashElement.closest('.search-result-item');
            if (resultItem) {
                copyCommitHashToClipboard(resultItem.dataset.commitId, hashElement);
            }
        });
    });
}

function highlightSearchTerm(text, query) {
    if (!text || !query) return text;
    
    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return text.replace(regex, '<span class="search-highlight">$1</span>');
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function handleSearchResultClick(commitId, filePath, resultType) {
    // Navigate to the commit (this handles all the UI updates)
    if (commitId) {
        await selectCommit(commitId);
        
        // If there's a specific file, select it after file changes load
        if (filePath && resultType !== 'commit') {
            // Wait a bit longer for file changes to load and DOM to update
            setTimeout(() => {
                const fileElement = document.querySelector(`[data-file-path="${filePath}"]`);
                if (fileElement) {
                    // Clear any existing selections first
                    document.querySelectorAll('.file-item').forEach(item => {
                        item.classList.remove('selected');
                    });
                    
                    // Select the specific file
                    fileElement.classList.add('selected');
                    const fileIndex = filteredFileItems.indexOf(fileElement);
                    if (fileIndex !== -1) {
                        currentFileIndex = fileIndex;
                    }
                    
                    // Scroll into view
                    fileElement.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'nearest',
                        inline: 'nearest'
                    });
                    
                    selectFile(filePath);
                }
            }, 200); // Increased timeout to ensure DOM is updated
        }
    }
}

function hideSearchResults() {
    const searchOverlay = document.getElementById('search-results-overlay');
    searchOverlay.classList.remove('show');
}

function initializeGlobalSearch() {
    const searchInput = document.getElementById('global-search');
    const searchOverlay = document.getElementById('search-results-overlay');
    const settingsBtn = document.getElementById('search-settings-btn');
    const settingsOverlay = document.getElementById('search-settings-overlay');
    const saveBtn = document.getElementById('save-search-settings');
    const cancelBtn = document.getElementById('cancel-search-settings');
    const limitInput = document.getElementById('search-limit-input');
    
    // Real-time search with debouncing
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value;
        
        // Clear previous timeout
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }
        
        if (query.trim().length < 2) {
            hideSearchResults();
            return;
        }
        
        // Debounce search to avoid too many requests
        searchTimeout = setTimeout(() => {
            performGlobalSearch(query);
        }, 300);
    });
    
    // Clear search on Escape
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            hideSearchResults();
            searchInput.blur();
        }
    });
    
    // Hide results when clicking outside (but not settings)
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchOverlay.contains(e.target) && !settingsOverlay.contains(e.target) && !settingsBtn.contains(e.target)) {
            hideSearchResults();
            hideSearchSettings();
        }
    });
    
    // Search settings functionality
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (settingsOverlay.classList.contains('show')) {
            hideSearchSettings();
        } else {
            showSearchSettings();
        }
    });
    
    saveBtn.addEventListener('click', () => {
        const newLimit = limitInput.value;
        if (setSearchLimit(newLimit)) {
            hideSearchSettings();
            // Show brief feedback
            settingsBtn.textContent = '✓';
            setTimeout(() => {
                settingsBtn.textContent = '⚙️';
            }, 1000);
        } else {
            // Show error feedback
            limitInput.style.borderColor = '#dc3545';
            setTimeout(() => {
                limitInput.style.borderColor = '#dee2e6';
            }, 2000);
        }
    });
    
    cancelBtn.addEventListener('click', () => {
        hideSearchSettings();
    });
    
    // Global keyboard shortcut (Ctrl+K or Cmd+K)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            searchInput.focus();
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

async function copyCommitHashToClipboard(commitId, element) {
    try {
        await navigator.clipboard.writeText(commitId);
        
        // Visual feedback
        const originalText = element.textContent;
        const originalBg = element.style.backgroundColor;
        
        // Show copied feedback
        element.style.backgroundColor = '#28a745';
        element.style.color = 'white';
        element.textContent = 'Copied!';
        
        // Reset after 1 second
        setTimeout(() => {
            element.style.backgroundColor = originalBg;
            element.style.color = '';
            element.textContent = originalText;
        }, 1000);
        
    } catch (error) {
        console.error('Failed to copy commit hash:', error);
        
        // Fallback feedback for error
        const originalText = element.textContent;
        const originalBg = element.style.backgroundColor;
        
        element.style.backgroundColor = '#dc3545';
        element.style.color = 'white';
        element.textContent = 'Failed';
        
        setTimeout(() => {
            element.style.backgroundColor = originalBg;
            element.style.color = '';
            element.textContent = originalText;
        }, 1000);
    }
}

async function loadLastRepository() {
    try {
        const lastRepo = localStorage.getItem(LAST_REPO_KEY);
        if (lastRepo) {
            await openRepository(lastRepo);
        }
    } catch (error) {
        console.error('Error loading last repository:', error);
        // Don't show error to user, just silently fail
    }
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
    
    // Initialize global search
    initializeGlobalSearch();
    
    // Initialize blame view
    initializeBlameView();
    
    // Load last opened repository
    await loadLastRepository();
    
    // Load git branches for current repository if available
    if (currentRepoPath) {
        await loadGitBranches(currentRepoPath);
    }
});