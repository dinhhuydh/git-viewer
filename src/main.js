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

// Language detection for syntax highlighting
function getLanguageFromFileName(fileName) {
    const extension = fileName.split('.').pop().toLowerCase();
    const languageMap = {
        'js': 'javascript',
        'jsx': 'javascript',
        'ts': 'typescript',
        'tsx': 'typescript',
        'py': 'python',
        'java': 'java',
        'rs': 'rust',
        'go': 'go',
        'cpp': 'cpp',
        'cc': 'cpp',
        'cxx': 'cpp',
        'c': 'c',
        'h': 'c',
        'hpp': 'cpp',
        'css': 'css',
        'scss': 'css',
        'sass': 'css',
        'html': 'html',
        'htm': 'html',
        'xml': 'html',
        'json': 'json',
        'yaml': 'yaml',
        'yml': 'yaml',
        'md': 'markdown',
        'markdown': 'markdown',
        'sh': 'bash',
        'bash': 'bash',
        'zsh': 'bash',
        'sql': 'sql',
        'php': 'php',
        'rb': 'ruby',
        'ex': 'elixir',
        'exs': 'elixir',
        'heex': 'html', // HEEx templates use HTML-like syntax
        'elm': 'elm',
        'swift': 'swift',
        'kt': 'kotlin',
        'scala': 'scala',
        'clj': 'clojure',
        'r': 'r',
        'dockerfile': 'docker',
        'toml': 'toml',
        'ini': 'ini',
        'cfg': 'ini',
        'conf': 'ini'
    };
    return languageMap[extension] || 'text';
}

function highlightCode(code, language) {
    if (!code || !window.Prism) return escapeHtml(code);
    
    try {
        if (language === 'text' || !Prism.languages[language]) {
            return escapeHtml(code);
        }
        
        const highlighted = Prism.highlight(code, Prism.languages[language], language);
        return highlighted;
    } catch (error) {
        console.warn('Syntax highlighting failed:', error);
        return escapeHtml(code);
    }
}

function getFileTypeIcon(fileName) {
    const extension = fileName.split('.').pop().toLowerCase();
    const iconMap = {
        // Web Development
        'js': '📄', 'jsx': '⚛️', 'ts': '🔷', 'tsx': '⚛️',
        'html': '🌐', 'htm': '🌐', 'css': '🎨', 'scss': '🎨', 'sass': '🎨',
        'json': '📋', 'xml': '📄',
        
        // Programming Languages
        'py': '🐍', 'java': '☕', 'rs': '🦀', 'go': '🐹',
        'cpp': '⚙️', 'cc': '⚙️', 'cxx': '⚙️', 'c': '⚙️', 'h': '⚙️', 'hpp': '⚙️',
        'php': '🐘', 'rb': '💎', 'swift': '🐦', 'kt': '🟣', 'scala': '🔴',
        'ex': '⚗️', 'exs': '⚗️', 'heex': '🧪', 'elm': '🌳',
        
        // Data & Config
        'yaml': '📝', 'yml': '📝', 'toml': '📝', 'ini': '📝', 'cfg': '📝', 'conf': '📝',
        'sql': '🗃️', 'db': '🗃️',
        
        // Documentation
        'md': '📖', 'markdown': '📖', 'txt': '📄', 'readme': '📖',
        
        // Scripts
        'sh': '🖥️', 'bash': '🖥️', 'zsh': '🖥️', 'ps1': '🖥️',
        'dockerfile': '🐳', 'docker': '🐳',
        
        // Images
        'png': '🖼️', 'jpg': '🖼️', 'jpeg': '🖼️', 'gif': '🖼️', 'svg': '🖼️',
        'ico': '🖼️', 'webp': '🖼️',
        
        // Other
        'pdf': '📕', 'zip': '📦', 'tar': '📦', 'gz': '📦',
        'lock': '🔒', 'env': '🔧', 'gitignore': '🚫', 'license': '📜'
    };
    
    // Check for special file names
    const lowerName = fileName.toLowerCase();
    if (lowerName === 'dockerfile' || lowerName === 'docker-compose.yml' || lowerName === 'docker-compose.yaml') {
        return '🐳';
    }
    if (lowerName === 'package.json' || lowerName === 'package-lock.json') {
        return '📦';
    }
    if (lowerName === 'cargo.toml' || lowerName === 'cargo.lock') {
        return '🦀';
    }
    if (lowerName === 'gemfile' || lowerName === 'gemfile.lock') {
        return '💎';
    }
    if (lowerName === 'requirements.txt' || lowerName === 'setup.py') {
        return '🐍';
    }
    if (lowerName === 'makefile' || lowerName === 'cmake') {
        return '⚙️';
    }
    if (lowerName.startsWith('.git')) {
        return '🔧';
    }
    
    return iconMap[extension] || '📄';
}

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

// Main view mode
let currentMainViewMode = 'diff'; // 'diff' or 'explorer'

// Explorer view
let currentFileTree = null;
let expandedDirectories = new Set();
let selectedExplorerFile = null;
let explorerFilterText = '';

// Sidebar mode
let currentSidebarMode = 'commits'; // 'commits', 'staged', or 'stash'

async function loadGitBranches(repoPath = null) {
    try {
        let branches;
        if (repoPath) {
            branches = await invoke('get_git_branches_from_path', { path: repoPath });
        } else {
            branches = await invoke('get_git_branches');
        }
        displayBranches(branches);
        
        // Also load remotes when loading branches
        if (repoPath) {
            await loadGitRemotes(repoPath);
        }
    } catch (error) {
        console.error('Error loading git branches:', error);
        const branchSelector = document.getElementById('branch-selector');
        if (branchSelector) {
            branchSelector.innerHTML = '<option value="">Error loading branches</option>';
        }
    }
}

async function loadGitRemotes(repoPath) {
    try {
        const remotes = await invoke('get_git_remotes_from_path', { path: repoPath });
        displayRemotes(remotes);
    } catch (error) {
        console.error('Error loading git remotes:', error);
        const remoteSelector = document.getElementById('remote-selector');
        if (remoteSelector) {
            remoteSelector.innerHTML = '<option value="">Error loading remotes</option>';
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

function displayRemotes(remotes) {
    const remoteSelector = document.getElementById('remote-selector');
    
    if (remotes.length === 0) {
        remoteSelector.innerHTML = '<option value="">No remotes found</option>';
        return;
    }
    
    // Group remotes by name to highlight current/default remote
    const remoteGroups = {};
    remotes.forEach(remote => {
        const baseName = remote.name.replace(' (push)', '');
        if (!remoteGroups[baseName]) {
            remoteGroups[baseName] = [];
        }
        remoteGroups[baseName].push(remote);
    });
    
    // Populate remote selector dropdown
    const remoteOptions = Object.keys(remoteGroups).map(remoteName => {
        const remoteGroup = remoteGroups[remoteName];
        const mainRemote = remoteGroup.find(r => !r.is_push) || remoteGroup[0];
        const isOrigin = remoteName === 'origin';
        
        return `<option value="${remoteName}" ${isOrigin ? 'selected' : ''}>${remoteName}${isOrigin ? ' (current)' : ''}</option>`;
    }).join('');
    
    remoteSelector.innerHTML = remoteOptions;
    
    // Add change listener to remote selector
    const newRemoteSelector = remoteSelector.cloneNode(true);
    remoteSelector.parentNode.replaceChild(newRemoteSelector, remoteSelector);
    
    newRemoteSelector.addEventListener('change', (e) => {
        const selectedRemote = e.target.value;
        if (selectedRemote) {
            const remoteGroup = remoteGroups[selectedRemote];
            if (remoteGroup && remoteGroup.length > 0) {
                const mainRemote = remoteGroup.find(r => !r.is_push) || remoteGroup[0];
                console.log(`Selected remote: ${selectedRemote} (${mainRemote.url})`);
                // Here you could add functionality to switch remote context
            }
        }
    });
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
        
        // Also update explorer view
        if (currentMainViewMode === 'explorer') {
            updateExplorerCommits();
        }
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
    
    // Update explorer view if it's currently active
    if (currentMainViewMode === 'explorer') {
        updateExplorerCommits();
    }
    
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
    
    // If we're in explorer mode, also update the explorer view
    if (currentMainViewMode === 'explorer') {
        await loadFileTree(commitId);
        // Update commit selection in explorer view
        document.querySelectorAll('#explorer-commits .commit-item').forEach(item => {
            item.classList.remove('selected');
        });
        const explorerSelectedElement = document.querySelector(`#explorer-commits [data-commit-id="${commitId}"]`);
        if (explorerSelectedElement) {
            explorerSelectedElement.classList.add('selected');
        }
    }
    
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
    
    const changesList = changes.map(change => {
        const icon = getFileTypeIcon(change.path);
        return `<div class="file-item" data-file-path="${change.path}">
            <span class="file-status ${change.status}"></span>
            <span class="file-icon">${icon}</span>
            <span class="file-path">${change.path}</span>
        </div>`;
    }).join('');
    
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
            <div class="diff-header">
                <div class="diff-header-content">
                    <span>${diff.path} (${diff.status})</span>
                    <button class="open-file-btn" data-file-path="${diff.path}" title="Open in editor">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18 13V19C18 20.1046 17.1046 21 16 21H5C3.89543 21 3 20.1046 3 19V8C3 6.89543 3.89543 6 5 6H11M15 3H21V9M10 14L21 3"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="binary-file">Binary file - cannot display diff</div>
        `;
        // Add event listener for the open file button
        const openFileBtn = diffDiv.querySelector('.open-file-btn');
        if (openFileBtn) {
            openFileBtn.addEventListener('click', () => {
                const filePath = openFileBtn.getAttribute('data-file-path');
                window.openFileInEditor(filePath);
            });
        }
        return;
    }
    
    if (diff.diff_lines.length === 0) {
        diffDiv.innerHTML = `
            <div class="diff-header">
                <div class="diff-header-content">
                    <span>${diff.path} (${diff.status})</span>
                    <button class="open-file-btn" data-file-path="${diff.path}" title="Open in editor">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18 13V19C18 20.1046 17.1046 21 16 21H5C3.89543 21 3 20.1046 3 19V8C3 6.89543 3.89543 6 5 6H11M15 3H21V9M10 14L21 3"/>
                        </svg>
                    </button>
                </div>
            </div>
            <p style="padding: 15px; color: #666; font-style: italic;">No changes to display</p>
        `;
        // Add event listener for the open file button
        const openFileBtn = diffDiv.querySelector('.open-file-btn');
        if (openFileBtn) {
            openFileBtn.addEventListener('click', () => {
                const filePath = openFileBtn.getAttribute('data-file-path');
                window.openFileInEditor(filePath);
            });
        }
        return;
    }
    
    // Get language for syntax highlighting
    const language = getLanguageFromFileName(diff.path);
    
    const diffContent = diff.diff_lines.map(line => {
        const oldLineNum = line.old_line_number ? line.old_line_number.toString() : '';
        const newLineNum = line.new_line_number ? line.new_line_number.toString() : '';
        const lineNumbers = `${oldLineNum} ${newLineNum}`.trim() || ' ';
        
        // Apply syntax highlighting to line content
        const highlightedContent = highlightCode(line.content, language);
        
        return `
            <div class="diff-line ${line.line_type}">
                <div class="line-numbers">${lineNumbers}</div>
                <div class="line-content">${highlightedContent}</div>
            </div>
        `;
    }).join('');
    
    diffDiv.innerHTML = `
        <div class="diff-header">
            <div class="diff-header-content">
                <span>${diff.path} (${diff.status})</span>
                <button class="open-file-btn" data-file-path="${diff.path}" title="Open in editor">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L2 7L12 12L22 7L12 2Z"/>
                        <path d="M2 17L12 22L22 17"/>
                        <path d="M2 12L12 17L22 12"/>
                    </svg>
                </button>
            </div>
        </div>
        ${diffContent}
    `;
    
    // Add event listener for the open file button
    const openFileBtn = diffDiv.querySelector('.open-file-btn');
    if (openFileBtn) {
        openFileBtn.addEventListener('click', () => {
            const filePath = openFileBtn.getAttribute('data-file-path');
            window.openFileInEditor(filePath);
        });
    }
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
            <div class="diff-header">
                <div class="diff-header-content">
                    <span>${blame.path} (blame)</span>
                    <button class="open-file-btn" data-file-path="${blame.path}" title="Open in editor">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18 13V19C18 20.1046 17.1046 21 16 21H5C3.89543 21 3 20.1046 3 19V8C3 6.89543 3.89543 6 5 6H11M15 3H21V9M10 14L21 3"/>
                        </svg>
                    </button>
                </div>
            </div>
            <p style="padding: 15px; color: #666; font-style: italic;">No content to display</p>
        `;
        // Add event listener for the open file button
        const openFileBtn = diffDiv.querySelector('.open-file-btn');
        if (openFileBtn) {
            openFileBtn.addEventListener('click', () => {
                const filePath = openFileBtn.getAttribute('data-file-path');
                window.openFileInEditor(filePath);
            });
        }
        return;
    }
    
    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    
    // Create header
    const header = document.createElement('div');
    header.className = 'diff-header';
    header.innerHTML = `
        <div class="diff-header-content">
            <span>${blame.path} (blame)</span>
            <button class="open-file-btn" data-file-path="${blame.path}" title="Open in editor">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z"/>
                    <path d="M2 17L12 22L22 17"/>
                    <path d="M2 12L12 17L22 12"/>
                </svg>
            </button>
        </div>
    `;
    fragment.appendChild(header);
    
    // Get language for syntax highlighting
    const language = getLanguageFromFileName(blame.path);
    
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
        
        // Create content with syntax highlighting
        const content = document.createElement('div');
        content.className = 'blame-content';
        content.innerHTML = highlightCode(line.content, language);
        
        lineDiv.appendChild(blameInfo);
        lineDiv.appendChild(lineNumber);
        lineDiv.appendChild(content);
        
        fragment.appendChild(lineDiv);
    });
    
    // Replace content efficiently
    diffDiv.innerHTML = '';
    diffDiv.appendChild(fragment);
    
    // Add event listener for the open file button
    const openFileBtn = diffDiv.querySelector('.open-file-btn');
    if (openFileBtn) {
        openFileBtn.addEventListener('click', () => {
            const filePath = openFileBtn.getAttribute('data-file-path');
            window.openFileInEditor(filePath);
        });
    }
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

// Function to open file in external editor
window.openFileInEditor = async function openFileInEditor(filePath) {
    console.log('openFileInEditor called with:', filePath);
    console.log('currentRepoPath:', currentRepoPath);
    console.log('selectedCommit:', selectedCommit);
    
    if (!currentRepoPath) {
        console.error('No repository selected');
        return;
    }
    
    if (!selectedCommit) {
        console.error('No commit selected');
        return;
    }

    try {
        console.log('Invoking open_file_in_editor with:', {
            repoPath: currentRepoPath,
            commitId: selectedCommit,
            filePath: filePath
        });
        
        await invoke('open_file_in_editor', {
            repoPath: currentRepoPath,
            commitId: selectedCommit,
            filePath: filePath
        });
        
        console.log('File opened successfully in TextEdit');
    } catch (error) {
        console.error('Failed to open file:', error);
    }
};

function switchToMainViewMode(mode) {
    if (currentMainViewMode === mode) return;
    
    currentMainViewMode = mode;
    
    const diffContainer = document.querySelector('.container');
    const explorerContainer = document.getElementById('explorer-container');
    const diffModeBtn = document.getElementById('diff-mode-btn');
    const explorerModeBtn = document.getElementById('explorer-mode-btn');
    
    if (mode === 'diff') {
        diffContainer.style.display = 'flex';
        explorerContainer.style.display = 'none';
        diffModeBtn.classList.add('active');
        explorerModeBtn.classList.remove('active');
    } else {
        diffContainer.style.display = 'none';
        explorerContainer.style.display = 'flex';
        diffModeBtn.classList.remove('active');
        explorerModeBtn.classList.add('active');
        
        // Update explorer view with current commits and selected commit
        updateExplorerCommits();
        
        // Load explorer view if we have a selected commit
        if (selectedCommit && currentRepoPath) {
            loadFileTree(selectedCommit);
        }
    }
}

function updateExplorerCommits() {
    const explorerCommitsDiv = document.getElementById('explorer-commits');
    const originalCommitsDiv = document.getElementById('commits');
    
    if (!explorerCommitsDiv || !originalCommitsDiv) return;
    
    // Copy HTML content from diff view commits
    explorerCommitsDiv.innerHTML = originalCommitsDiv.innerHTML;
    
    // Add click listeners to explorer commits
    const explorerCommitItems = explorerCommitsDiv.querySelectorAll('.commit-item');
    explorerCommitItems.forEach((commitItem) => {
        commitItem.addEventListener('click', () => {
            const commitId = commitItem.dataset.commitId;
            selectExplorerCommit(commitId);
        });
        
        // Add hash copy listeners
        const commitHashElement = commitItem.querySelector('.commit-id');
        if (commitHashElement) {
            commitHashElement.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                copyCommitHashToClipboard(commitItem.dataset.commitId, commitHashElement);
            });
        }
    });
    
    // If we have a selected commit, make sure it's selected in explorer view too
    if (selectedCommit) {
        const selectedElement = explorerCommitsDiv.querySelector(`[data-commit-id="${selectedCommit}"]`);
        if (selectedElement) {
            selectedElement.classList.add('selected');
        }
    }
}

async function loadExplorerView(commitId) {
    if (!currentRepoPath) return;
    
    try {
        // Update commits in explorer view
        updateExplorerCommits();
        
        // Load file tree for the selected commit
        await loadFileTree(commitId);
    } catch (error) {
        console.error('Error loading explorer view:', error);
        document.getElementById('file-explorer').innerHTML = `<p style="padding: 15px; color: #dc3545;">Error: ${error}</p>`;
    }
}

async function selectExplorerCommit(commitId) {
    // Update commit selection in explorer view
    document.querySelectorAll('#explorer-commits .commit-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    const selectedElement = document.querySelector(`#explorer-commits [data-commit-id="${commitId}"]`);
    if (selectedElement) {
        selectedElement.classList.add('selected');
    }
    
    selectedCommit = commitId;
    await loadFileTree(commitId);
}

async function loadFileTree(commitId) {
    if (!currentRepoPath) return;
    
    const explorerDiv = document.getElementById('file-explorer');
    
    try {
        explorerDiv.innerHTML = '<div class="loading-explorer"><div class="loading-spinner"></div><p>Loading file tree...</p></div>';
        
        const fileTree = await invoke('get_commit_file_tree', {
            path: currentRepoPath,
            commitId: commitId
        });
        
        currentFileTree = fileTree;
        
        // Auto-expand root level directories for better UX
        fileTree.forEach(item => {
            if (item.is_directory) {
                expandedDirectories.add(item.path);
            }
        });
        
        // Clear filter when loading new commit
        const filterInput = document.getElementById('explorer-filter');
        if (filterInput) {
            filterInput.value = '';
            explorerFilterText = '';
        }
        
        displayFileTree(fileTree);
    } catch (error) {
        console.error('Error loading file tree:', error);
        explorerDiv.innerHTML = `<p style="padding: 15px; color: #dc3545;">Error: ${error}</p>`;
    }
}

function getFileIcon(fileType, isDirectory) {
    if (isDirectory) {
        return '📁';
    }
    
    const iconMap = {
        'javascript': '📄',
        'typescript': '🔷', 
        'python': '🐍',
        'rust': '🦀',
        'java': '☕',
        'go': '🐹',
        'c': '⚙️',
        'cpp': '⚙️',
        'css': '🎨',
        'html': '🌐',
        'json': '📋',
        'yaml': '📝',
        'markdown': '📖',
        'shell': '🖥️',
        'sql': '🗃️',
        'xml': '📄',
        'toml': '📝',
        'config': '📝',
        'docker': '🐳',
        'git': '🔧',
        'text': '📄',
        'folder': '📁'
    };
    
    return iconMap[fileType] || '📄';
}

function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${Math.round(bytes / (1024 * 1024))}MB`;
}

function displayFileTree(items) {
    const explorerDiv = document.getElementById('file-explorer');
    const treeHtml = buildFileTreeHtml(items, 0);
    explorerDiv.innerHTML = `<ul class="file-tree">${treeHtml}</ul>`;
    
    // Add event listeners
    initializeFileTreeInteractions();
    
    // Apply current filter if any
    const filterInput = document.getElementById('explorer-filter');
    if (filterInput && filterInput.value) {
        filterExplorerFiles(filterInput.value);
    }
}

function buildFileTreeHtml(items, depth) {
    return items.map(item => {
        const icon = getFileIcon(item.file_type, item.is_directory);
        const sizeText = item.size ? formatFileSize(item.size) : '';
        const isExpanded = expandedDirectories.has(item.path);
        
        let html = `<li data-path="${item.path}" data-is-directory="${item.is_directory}">`;
        html += `<div class="file-tree-item ${item.is_directory ? 'directory' : 'file'}">`;
        
        // Add indentation
        for (let i = 0; i < depth; i++) {
            html += '<span class="file-tree-indent"></span>';
        }
        
        // Add toggle for directories
        if (item.is_directory) {
            html += `<span class="file-tree-toggle ${isExpanded ? 'expanded' : ''}" data-path="${item.path}">▶</span>`;
        } else {
            html += '<span class="file-tree-indent"></span>';
        }
        
        html += `<span class="file-tree-icon">${icon}</span>`;
        html += `<span class="file-tree-name">${item.name}</span>`;
        if (sizeText) {
            html += `<span class="file-tree-size">${sizeText}</span>`;
        }
        html += '</div>'; // Close file-tree-item div
        
        // Add children if directory has them
        if (item.is_directory && item.children && item.children.length > 0) {
            const childrenClass = isExpanded ? 'file-tree-children' : 'file-tree-children collapsed';
            html += `<ul class="${childrenClass}">${buildFileTreeHtml(item.children, depth + 1)}</ul>`;
        }
        
        html += '</li>';
        
        return html;
    }).join('');
}

function initializeFileTreeInteractions() {
    const explorerDiv = document.getElementById('file-explorer');
    
    // Handle directory toggle
    explorerDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('file-tree-toggle')) {
            e.stopPropagation();
            const path = e.target.dataset.path;
            toggleDirectory(path, e.target);
        }
    });
    
    // Handle file/directory selection
    explorerDiv.addEventListener('click', (e) => {
        const treeItem = e.target.closest('.file-tree-item');
        if (treeItem) {
            const listItem = treeItem.closest('li');
            const path = listItem.dataset.path;
            const isDirectory = listItem.dataset.isDirectory === 'true';
            
            if (isDirectory) {
                // Toggle directory on click
                const toggleElement = treeItem.querySelector('.file-tree-toggle');
                if (toggleElement) {
                    toggleDirectory(path, toggleElement);
                }
            } else {
                // Select file
                selectExplorerFile(path, treeItem);
            }
        }
    });
}

function toggleDirectory(path, toggleElement) {
    const listItem = toggleElement.closest('li');
    const childrenElement = listItem.querySelector('.file-tree-children');
    
    if (expandedDirectories.has(path)) {
        // Collapse
        expandedDirectories.delete(path);
        toggleElement.classList.remove('expanded');
        if (childrenElement) {
            childrenElement.classList.add('collapsed');
        }
    } else {
        // Expand
        expandedDirectories.add(path);
        toggleElement.classList.add('expanded');
        if (childrenElement) {
            childrenElement.classList.remove('collapsed');
        }
    }
}

async function selectExplorerFile(filePath, treeItem) {
    if (!currentRepoPath || !selectedCommit) return;
    
    selectedExplorerFile = filePath;
    
    // Update selection UI
    document.querySelectorAll('.file-tree-item').forEach(item => {
        item.classList.remove('selected');
    });
    treeItem.classList.add('selected');
    
    // Load file content
    await loadFileContent(filePath);
}

async function loadFileContent(filePath) {
    if (!currentRepoPath || !selectedCommit) return;
    
    const contentHeader = document.getElementById('file-content-header');
    const contentBody = document.getElementById('file-content-body');
    
    try {
        contentHeader.innerHTML = `<span>${filePath}</span>`;
        contentBody.innerHTML = '<div class="loading-explorer"><div class="loading-spinner"></div><p>Loading file content...</p></div>';
        
        const content = await invoke('get_file_content', {
            path: currentRepoPath,
            commitId: selectedCommit,
            filePath: filePath
        });
        
        displayFileContent(filePath, content);
    } catch (error) {
        console.error('Error loading file content:', error);
        contentBody.innerHTML = `<p style="padding: 15px; color: #dc3545;">Error: ${error}</p>`;
    }
}

function displayFileContent(filePath, content) {
    const contentBody = document.getElementById('file-content-body');
    const language = getLanguageFromFileName(filePath);
    
    const lines = content.split('\n');
    const linesHtml = lines.map((line, index) => {
        const lineNumber = index + 1;
        const highlightedContent = highlightCode(line, language);
        
        return `
            <div class="file-content-line">
                <div class="file-content-line-number">${lineNumber}</div>
                <div class="file-content-line-content">${highlightedContent}</div>
            </div>
        `;
    }).join('');
    
    contentBody.innerHTML = linesHtml;
}

// Fuzzy search implementation
function fuzzyMatch(pattern, text) {
    if (!pattern) return { matches: true, score: 0, highlights: [] };
    if (!text) return { matches: false, score: 0, highlights: [] };
    
    pattern = pattern.toLowerCase();
    text = text.toLowerCase();
    
    let patternIndex = 0;
    let textIndex = 0;
    let score = 0;
    let highlights = [];
    let consecutiveMatches = 0;
    
    while (patternIndex < pattern.length && textIndex < text.length) {
        if (pattern[patternIndex] === text[textIndex]) {
            highlights.push(textIndex);
            consecutiveMatches++;
            score += consecutiveMatches * 2; // Bonus for consecutive matches
            patternIndex++;
        } else {
            consecutiveMatches = 0;
        }
        textIndex++;
    }
    
    // Check if all pattern characters were matched
    const matches = patternIndex === pattern.length;
    
    if (matches) {
        // Bonus for matches at word boundaries
        highlights.forEach(index => {
            if (index === 0 || text[index - 1] === '/' || text[index - 1] === '.') {
                score += 5;
            }
        });
        
        // Penalty for longer text (prefer shorter matches)
        score -= text.length * 0.1;
    }
    
    return { matches, score, highlights };
}

function highlightFuzzyMatch(text, highlights) {
    if (!highlights || highlights.length === 0) return text;
    
    let result = '';
    let lastIndex = 0;
    
    highlights.forEach(index => {
        result += text.substring(lastIndex, index);
        result += `<span class="fuzzy-highlight">${text[index]}</span>`;
        lastIndex = index + 1;
    });
    
    result += text.substring(lastIndex);
    return result;
}

function flattenFileTree(items, currentPath = '') {
    let flatItems = [];
    
    items.forEach(item => {
        const fullPath = currentPath ? `${currentPath}/${item.name}` : item.name;
        flatItems.push({
            ...item,
            fullPath: fullPath,
            displayPath: item.path
        });
        
        if (item.is_directory && item.children) {
            flatItems = flatItems.concat(flattenFileTree(item.children, fullPath));
        }
    });
    
    return flatItems;
}

function filterExplorerFiles(filterText) {
    explorerFilterText = filterText.trim();
    
    if (!currentFileTree) return;
    
    const explorerDiv = document.getElementById('file-explorer');
    
    if (!explorerFilterText) {
        // No filter - show normal tree structure
        displayFileTree(currentFileTree);
        return;
    }
    
    // Get all file items (not directories)
    const fileItems = flattenFileTree(currentFileTree).filter(item => !item.is_directory);
    
    // Score and filter items
    const matchedItems = fileItems.map(item => {
        const nameMatch = fuzzyMatch(explorerFilterText, item.name);
        const pathMatch = fuzzyMatch(explorerFilterText, item.displayPath);
        
        // Use the best match
        const match = nameMatch.score >= pathMatch.score ? nameMatch : pathMatch;
        const searchText = nameMatch.score >= pathMatch.score ? item.name : item.displayPath;
        
        return {
            ...item,
            fuzzyMatch: match,
            searchText: searchText
        };
    }).filter(item => item.fuzzyMatch.matches)
      .sort((a, b) => b.fuzzyMatch.score - a.fuzzyMatch.score);
    
    // Show filtered results as a flat list
    if (matchedItems.length === 0) {
        explorerDiv.innerHTML = '<div style="padding: 15px; color: #666; font-style: italic;">No files match your search</div>';
        return;
    }
    
    // Add results counter
    const resultsHeader = `<div class="filtered-results-header">${matchedItems.length} file${matchedItems.length === 1 ? '' : 's'} found</div>`;
    
    const flatListHtml = matchedItems.map(item => {
        const icon = getFileIcon(item.file_type, item.is_directory);
        const highlightedName = item.searchText === item.name ? 
            highlightFuzzyMatch(item.name, item.fuzzyMatch.highlights) : 
            item.name;
        
        // Show directory path as subtitle for context
        const directoryPath = item.displayPath.includes('/') ? 
            item.displayPath.substring(0, item.displayPath.lastIndexOf('/')) : 
            '';
        
        return `
            <div class="filtered-file-item" data-path="${item.displayPath}" data-is-directory="false">
                <div class="file-tree-item file filtered-match">
                    <span class="file-tree-icon">${icon}</span>
                    <div class="filtered-file-info">
                        <div class="file-tree-name">${highlightedName}</div>
                        ${directoryPath ? `<div class="filtered-file-path">${directoryPath}</div>` : ''}
                    </div>
                    <span class="file-tree-size">${item.size ? formatFileSize(item.size) : ''}</span>
                </div>
            </div>
        `;
    }).join('');
    
    explorerDiv.innerHTML = `${resultsHeader}<div class="filtered-results">${flatListHtml}</div>`;
    
    // Add click listeners for filtered items
    initializeFilteredFileInteractions();
}

function expandParentDirectories(filePath) {
    const pathParts = filePath.split('/');
    let currentPath = '';
    
    for (let i = 0; i < pathParts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i];
        expandedDirectories.add(currentPath);
        
        // Update UI for expanded directory
        const toggleElement = document.querySelector(`[data-path="${currentPath}"] .file-tree-toggle`);
        if (toggleElement) {
            toggleElement.classList.add('expanded');
        }
        
        const childrenElement = document.querySelector(`li[data-path="${currentPath}"] .file-tree-children`);
        if (childrenElement) {
            childrenElement.classList.remove('collapsed');
        }
    }
}

function initializeFilteredFileInteractions() {
    const explorerDiv = document.getElementById('file-explorer');
    
    // Handle file selection in filtered view
    explorerDiv.addEventListener('click', (e) => {
        const filteredItem = e.target.closest('.filtered-file-item');
        if (filteredItem) {
            const filePath = filteredItem.dataset.path;
            
            // Update selection UI
            document.querySelectorAll('.filtered-file-item .file-tree-item').forEach(item => {
                item.classList.remove('selected');
            });
            const treeItem = filteredItem.querySelector('.file-tree-item');
            if (treeItem) {
                treeItem.classList.add('selected');
            }
            
            // Select the file
            selectExplorerFile(filePath, treeItem);
        }
    });
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

function initializeExplorerFilter() {
    const filterInput = document.getElementById('explorer-filter');
    if (!filterInput) return;
    
    let filterTimeout = null;
    
    // Real-time filtering with debouncing
    filterInput.addEventListener('input', (e) => {
        const query = e.target.value;
        
        // Clear previous timeout
        if (filterTimeout) {
            clearTimeout(filterTimeout);
        }
        
        // Debounce filter to avoid too many updates
        filterTimeout = setTimeout(() => {
            filterExplorerFiles(query);
        }, 150);
    });
    
    // Clear filter on Escape
    filterInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            filterInput.value = '';
            filterExplorerFiles('');
            filterInput.blur();
        }
    });
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
    
    // Auto-refresh branches when window becomes focused
    window.addEventListener('focus', async () => {
        if (currentRepoPath) {
            console.log('Window focused, refreshing branches...');
            await loadGitBranches(currentRepoPath);
        }
    });
    
    // Initialize main view mode buttons
    const diffModeBtn = document.getElementById('diff-mode-btn');
    const explorerModeBtn = document.getElementById('explorer-mode-btn');
    
    diffModeBtn.addEventListener('click', () => {
        switchToMainViewMode('diff');
    });
    
    explorerModeBtn.addEventListener('click', () => {
        switchToMainViewMode('explorer');
    });
    
    // Initialize explorer filter
    initializeExplorerFilter();
    
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
    
    // Setup sidebar tabs
    setupSidebarTabs();
    
    // Load git branches for current repository if available
    if (currentRepoPath) {
        await loadGitBranches(currentRepoPath);
    }
});

function setupSidebarTabs() {
    const commitsTabBtn = document.getElementById('commits-tab-btn');
    const stagedTabBtn = document.getElementById('staged-tab-btn');
    const stashTabBtn = document.getElementById('stash-tab-btn');
    const explorerCommitsTabBtn = document.getElementById('explorer-commits-tab-btn');
    const explorerStagedTabBtn = document.getElementById('explorer-staged-tab-btn');
    const explorerStashTabBtn = document.getElementById('explorer-stash-tab-btn');
    
    commitsTabBtn.addEventListener('click', () => switchSidebarMode('commits'));
    stagedTabBtn.addEventListener('click', () => switchSidebarMode('staged'));
    stashTabBtn.addEventListener('click', () => switchSidebarMode('stash'));
    explorerCommitsTabBtn.addEventListener('click', () => switchSidebarMode('commits'));
    explorerStagedTabBtn.addEventListener('click', () => switchSidebarMode('staged'));
    explorerStashTabBtn.addEventListener('click', () => switchSidebarMode('stash'));
}

function switchSidebarMode(mode) {
    if (currentSidebarMode === mode) return;
    
    currentSidebarMode = mode;
    
    // Update tab buttons
    const allTabs = document.querySelectorAll('.sidebar-tab');
    allTabs.forEach(tab => tab.classList.remove('active'));
    
    if (currentMainViewMode === 'diff') {
        const activeTab = mode === 'commits' ? 
            document.getElementById('commits-tab-btn') : 
            mode === 'staged' ?
            document.getElementById('staged-tab-btn') :
            document.getElementById('stash-tab-btn');
        activeTab.classList.add('active');
        
        // Show/hide content
        document.getElementById('commits').style.display = mode === 'commits' ? 'block' : 'none';
        document.getElementById('staged').style.display = mode === 'staged' ? 'block' : 'none';
        document.getElementById('stash').style.display = mode === 'stash' ? 'block' : 'none';
    } else {
        const activeTab = mode === 'commits' ? 
            document.getElementById('explorer-commits-tab-btn') : 
            mode === 'staged' ?
            document.getElementById('explorer-staged-tab-btn') :
            document.getElementById('explorer-stash-tab-btn');
        activeTab.classList.add('active');
        
        // Show/hide content
        document.getElementById('explorer-commits').style.display = mode === 'commits' ? 'block' : 'none';
        document.getElementById('explorer-staged').style.display = mode === 'staged' ? 'block' : 'none';
        document.getElementById('explorer-stash').style.display = mode === 'stash' ? 'block' : 'none';
    }
    
    // Load content based on selected mode
    if (mode === 'staged' && currentBranch && currentBranch.is_current) {
        loadStagedChanges();
        updateFileChangesForStaged();
    } else if (mode === 'stash') {
        loadStashes();
        updateFileChangesForStash();
    } else if (mode === 'commits') {
        // Clear file changes pane when switching back to commits
        const fileChangesDiv = document.getElementById('file-changes');
        fileChangesDiv.innerHTML = '<p style="padding: 15px; color: #666; font-style: italic;">Select a commit to view file changes</p>';
        
        // Clear diff panel
        const diffDiv = document.getElementById('file-diff');
        diffDiv.innerHTML = '<p style="padding: 15px; color: #666; font-style: italic;">Select a file to view changes</p>';
        
        const diffPanelTitle = document.getElementById('diff-panel-title');
        diffPanelTitle.textContent = 'File Diff';
        
        // Reset File Changes header
        const panelHeader = fileChangesDiv.previousElementSibling;
        if (panelHeader && panelHeader.classList.contains('panel-header-with-filter')) {
            panelHeader.innerHTML = `
                File Changes
                <input type="text" class="filter-input" id="file-filter" placeholder="Filter files..." />
            `;
            
            // Reinitialize file filtering for commits
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
        
        // Clear selectedCommit when switching back to commits to avoid confusion
        selectedCommit = null;
        
        // Remove any commit selection highlights
        document.querySelectorAll('.commit.selected').forEach(el => {
            el.classList.remove('selected');
        });
    }
}

async function loadStagedChanges() {
    if (!currentRepoPath) return;
    
    try {
        const stagedChanges = await invoke('get_staged_changes', { path: currentRepoPath });
        
        const stagedDiv = currentMainViewMode === 'diff' ? 
            document.getElementById('staged') : 
            document.getElementById('explorer-staged');
        
        if (stagedChanges.length === 0) {
            stagedDiv.innerHTML = '<p style="padding: 15px; color: #666; font-style: italic;">No staged changes</p>';
            return;
        }
        
        let stagedHtml = '<div class="staged-changes-list">';
        stagedChanges.forEach(file => {
            const statusIcon = getStatusIcon(file.status);
            stagedHtml += `
                <div class="staged-file" data-path="${file.path}">
                    <span class="file-status ${file.status}">${statusIcon}</span>
                    <span class="file-path">${file.path}</span>
                </div>
            `;
        });
        stagedHtml += '</div>';
        
        stagedDiv.innerHTML = stagedHtml;
        
        // Add click handlers for staged files
        const stagedFiles = stagedDiv.querySelectorAll('.staged-file');
        stagedFiles.forEach(fileElement => {
            fileElement.addEventListener('click', () => {
                const filePath = fileElement.dataset.path;
                selectStagedFile(filePath);
            });
        });
        
    } catch (error) {
        console.error('Failed to load staged changes:', error);
        const stagedDiv = currentMainViewMode === 'diff' ? 
            document.getElementById('staged') : 
            document.getElementById('explorer-staged');
        stagedDiv.innerHTML = '<p style="padding: 15px; color: #dc3545; font-style: italic;">Failed to load staged changes</p>';
    }
}

function getStatusIcon(status) {
    switch (status) {
        case 'added': return '✓';
        case 'modified': return '●';
        case 'deleted': return '✗';
        case 'renamed': return '→';
        default: return '?';
    }
}

async function selectStagedFile(filePath) {
    if (!currentRepoPath) return;
    
    // Remove previous selection
    document.querySelectorAll('.staged-file.selected').forEach(el => {
        el.classList.remove('selected');
    });
    
    // Add selection to clicked file
    const stagedDiv = currentMainViewMode === 'diff' ? 
        document.getElementById('staged') : 
        document.getElementById('explorer-staged');
    const fileElement = stagedDiv.querySelector(`[data-path="${filePath}"]`);
    if (fileElement) {
        fileElement.classList.add('selected');
    }
    
    try {
        const fileDiff = await invoke('get_staged_file_diff', { 
            path: currentRepoPath, 
            filePath: filePath 
        });
        
        displayStagedFileDiff(fileDiff);
        
    } catch (error) {
        console.error('Failed to get staged file diff:', error);
        const diffDiv = document.getElementById('file-diff');
        diffDiv.innerHTML = '<p style="padding: 15px; color: #dc3545;">Failed to load staged file diff</p>';
    }
}

function displayStagedFileDiff(fileDiff) {
    const diffDiv = document.getElementById('file-diff');
    const diffPanelTitle = document.getElementById('diff-panel-title');
    
    diffPanelTitle.textContent = `Staged: ${fileDiff.path}`;
    
    if (fileDiff.is_binary) {
        diffDiv.innerHTML = '<div class="binary-file">Binary file - cannot display diff</div>';
        return;
    }
    
    if (fileDiff.diff_lines.length === 0) {
        diffDiv.innerHTML = '<p style="padding: 15px; color: #666;">No diff to display</p>';
        return;
    }
    
    let diffHtml = '<div class="diff-content">';
    fileDiff.diff_lines.forEach(line => {
        const lineClass = `diff-line ${line.line_type}`;
        const lineNumber = line.line_type === 'deletion' ? 
            (line.old_line_number ? line.old_line_number : '') :
            (line.new_line_number ? line.new_line_number : '');
        
        diffHtml += `
            <div class="${lineClass}">
                <span class="line-number" data-line="${lineNumber}">${lineNumber}</span>
                <span class="line-content">${escapeHtml(line.content)}</span>
            </div>
        `;
    });
    diffHtml += '</div>';
    
    diffDiv.innerHTML = diffHtml;
}

async function updateFileChangesForStaged() {
    if (!currentRepoPath) return;
    
    try {
        const stagedChanges = await invoke('get_staged_changes', { path: currentRepoPath });
        
        const fileChangesDiv = document.getElementById('file-changes');
        const panelHeader = fileChangesDiv.previousElementSibling;
        
        // Update header to show "Staged Changes"
        if (panelHeader && panelHeader.classList.contains('panel-header-with-filter')) {
            panelHeader.innerHTML = `
                Staged Changes
                <input type="text" class="filter-input" id="file-filter" placeholder="Filter files..." />
            `;
            
            // Reinitialize file filtering
            const filterInput = document.getElementById('file-filter');
            filterInput.addEventListener('input', (e) => {
                filterStagedFiles(e.target.value);
            });
            filterInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    filterInput.value = '';
                    filterStagedFiles('');
                    filterInput.blur();
                }
            });
        }
        
        if (stagedChanges.length === 0) {
            fileChangesDiv.innerHTML = '<p style="padding: 15px; color: #666; font-style: italic;">No staged changes</p>';
            return;
        }
        
        // Display staged files in File Changes pane
        let fileChangesHtml = '<div class="file-changes-list">';
        stagedChanges.forEach(file => {
            const statusIcon = getStatusIcon(file.status);
            const fileTypeIcon = getFileTypeIcon(file.path);
            
            fileChangesHtml += `
                <div class="file-change staged-file-change" data-path="${file.path}">
                    <div class="file-info">
                        <span class="file-type-icon">${fileTypeIcon}</span>
                        <span class="file-path">${file.path}</span>
                        <span class="open-file-btn" data-path="${file.path}" data-commit="staged" title="Open file in editor">
                            <svg viewBox="0 0 16 16" fill="currentColor">
                                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                            </svg>
                        </span>
                    </div>
                    <div class="file-stats">
                        <span class="file-status ${file.status}" title="${file.status}">${statusIcon}</span>
                    </div>
                </div>
            `;
        });
        fileChangesHtml += '</div>';
        
        fileChangesDiv.innerHTML = fileChangesHtml;
        
        // Add click handlers for staged file changes
        const stagedFileChanges = fileChangesDiv.querySelectorAll('.staged-file-change');
        stagedFileChanges.forEach(fileElement => {
            fileElement.addEventListener('click', () => {
                const filePath = fileElement.dataset.path;
                selectStagedFileFromChanges(filePath, fileElement);
            });
        });
        
        // Add open file handlers
        addOpenFileHandlers(fileChangesDiv);
        
    } catch (error) {
        console.error('Failed to update file changes for staged:', error);
        const fileChangesDiv = document.getElementById('file-changes');
        fileChangesDiv.innerHTML = '<p style="padding: 15px; color: #dc3545; font-style: italic;">Failed to load staged changes</p>';
    }
}

async function selectStagedFileFromChanges(filePath, fileElement) {
    if (!currentRepoPath) return;
    
    // Remove previous selection
    document.querySelectorAll('.file-change.selected').forEach(el => {
        el.classList.remove('selected');
    });
    
    // Add selection to clicked file
    fileElement.classList.add('selected');
    
    try {
        const fileDiff = await invoke('get_staged_file_diff', { 
            path: currentRepoPath, 
            filePath: filePath 
        });
        
        displayStagedFileDiff(fileDiff);
        
    } catch (error) {
        console.error('Failed to get staged file diff:', error);
        const diffDiv = document.getElementById('file-diff');
        diffDiv.innerHTML = '<p style="padding: 15px; color: #dc3545;">Failed to load staged file diff</p>';
    }
}

function filterStagedFiles(filterText) {
    const fileChanges = document.querySelectorAll('.staged-file-change');
    
    fileChanges.forEach(fileChange => {
        const filePath = fileChange.dataset.path;
        const shouldShow = filterText === '' || filePath.toLowerCase().includes(filterText.toLowerCase());
        fileChange.style.display = shouldShow ? 'block' : 'none';
    });
}

async function loadStashes() {
    if (!currentRepoPath) return;
    
    try {
        const stashes = await invoke('get_stashes', { path: currentRepoPath });
        
        const stashDiv = currentMainViewMode === 'diff' ? 
            document.getElementById('stash') : 
            document.getElementById('explorer-stash');
        
        if (stashes.length === 0) {
            stashDiv.innerHTML = '<p style="padding: 15px; color: #666; font-style: italic;">No stashes</p>';
            return;
        }
        
        let stashHtml = '<div class="stash-list">';
        stashes.forEach(stash => {
            const shortCommitId = stash.commit_id.substring(0, 8);
            stashHtml += `
                <div class="stash-item" data-index="${stash.index}" data-commit="${stash.commit_id}">
                    <div class="stash-header">
                        <span class="stash-index">stash@{${stash.index}}</span>
                        <span class="stash-commit-id">${shortCommitId}</span>
                    </div>
                    <div class="stash-message">${stash.message}</div>
                    <div class="stash-meta">
                        <span class="stash-author">${stash.author}</span>
                        <span class="stash-date">${stash.date}</span>
                    </div>
                </div>
            `;
        });
        stashHtml += '</div>';
        
        stashDiv.innerHTML = stashHtml;
        
        // Add click handlers for stashes
        const stashItems = stashDiv.querySelectorAll('.stash-item');
        stashItems.forEach(stashElement => {
            stashElement.addEventListener('click', () => {
                const stashIndex = parseInt(stashElement.dataset.index);
                const commitId = stashElement.dataset.commit;
                selectStash(stashIndex, commitId, stashElement);
            });
        });
        
    } catch (error) {
        console.error('Failed to load stashes:', error);
        const stashDiv = currentMainViewMode === 'diff' ? 
            document.getElementById('stash') : 
            document.getElementById('explorer-stash');
        stashDiv.innerHTML = '<p style="padding: 15px; color: #dc3545; font-style: italic;">Failed to load stashes</p>';
    }
}

async function selectStash(stashIndex, commitId, stashElement) {
    if (!currentRepoPath) return;
    
    // Remove previous selection
    document.querySelectorAll('.stash-item.selected').forEach(el => {
        el.classList.remove('selected');
    });
    
    // Add selection to clicked stash
    stashElement.classList.add('selected');
    
    try {
        const stashDiff = await invoke('get_stash_diff', { 
            path: currentRepoPath, 
            stashIndex: stashIndex 
        });
        
        displayStashChanges(stashDiff, stashIndex);
        
    } catch (error) {
        console.error('Failed to get stash diff:', error);
        const fileChangesDiv = document.getElementById('file-changes');
        fileChangesDiv.innerHTML = '<p style="padding: 15px; color: #dc3545;">Failed to load stash changes</p>';
    }
}

function displayStashChanges(fileChanges, stashIndex) {
    const fileChangesDiv = document.getElementById('file-changes');
    
    if (fileChanges.length === 0) {
        fileChangesDiv.innerHTML = '<p style="padding: 15px; color: #666; font-style: italic;">No changes in this stash</p>';
        return;
    }
    
    let fileChangesHtml = '<div class="file-changes-list">';
    fileChanges.forEach(file => {
        const statusIcon = getStatusIcon(file.status);
        const fileTypeIcon = getFileTypeIcon(file.path);
        
        fileChangesHtml += `
            <div class="file-change stash-file-change" data-path="${file.path}" data-stash-index="${stashIndex}">
                <div class="file-info">
                    <span class="file-type-icon">${fileTypeIcon}</span>
                    <span class="file-path">${file.path}</span>
                </div>
                <div class="file-stats">
                    <span class="file-status ${file.status}" title="${file.status}">${statusIcon}</span>
                    <span class="file-additions">+${file.additions}</span>
                    <span class="file-deletions">-${file.deletions}</span>
                </div>
            </div>
        `;
    });
    fileChangesHtml += '</div>';
    
    fileChangesDiv.innerHTML = fileChangesHtml;
    
    // Add click handlers for stash file changes
    const stashFileChanges = fileChangesDiv.querySelectorAll('.stash-file-change');
    stashFileChanges.forEach(fileElement => {
        fileElement.addEventListener('click', () => {
            const filePath = fileElement.dataset.path;
            const stashIndex = parseInt(fileElement.dataset.stashIndex);
            selectStashFileFromChanges(filePath, stashIndex, fileElement);
        });
    });
}

async function selectStashFileFromChanges(filePath, stashIndex, fileElement) {
    if (!currentRepoPath) return;
    
    // Remove previous selection
    document.querySelectorAll('.file-change.selected').forEach(el => {
        el.classList.remove('selected');
    });
    
    // Add selection to clicked file
    fileElement.classList.add('selected');
    
    try {
        const fileDiff = await invoke('get_stash_file_diff', { 
            path: currentRepoPath, 
            stashIndex: stashIndex,
            filePath: filePath 
        });
        
        displayStashFileDiff(fileDiff, stashIndex);
        
    } catch (error) {
        console.error('Failed to get stash file diff:', error);
        const diffDiv = document.getElementById('file-diff');
        diffDiv.innerHTML = '<p style="padding: 15px; color: #dc3545;">Failed to load stash file diff</p>';
    }
}

function displayStashFileDiff(fileDiff, stashIndex) {
    const diffDiv = document.getElementById('file-diff');
    const diffPanelTitle = document.getElementById('diff-panel-title');
    
    diffPanelTitle.textContent = `Stash@{${stashIndex}}: ${fileDiff.path}`;
    
    if (fileDiff.is_binary) {
        diffDiv.innerHTML = '<div class="binary-file">Binary file - cannot display diff</div>';
        return;
    }
    
    if (fileDiff.diff_lines.length === 0) {
        diffDiv.innerHTML = '<p style="padding: 15px; color: #666;">No diff to display</p>';
        return;
    }
    
    let diffHtml = '<div class="diff-content">';
    fileDiff.diff_lines.forEach(line => {
        const lineClass = `diff-line ${line.line_type}`;
        const lineNumber = line.line_type === 'deletion' ? 
            (line.old_line_number ? line.old_line_number : '') :
            (line.new_line_number ? line.new_line_number : '');
        
        diffHtml += `
            <div class="${lineClass}">
                <span class="line-number" data-line="${lineNumber}">${lineNumber}</span>
                <span class="line-content">${escapeHtml(line.content)}</span>
            </div>
        `;
    });
    diffHtml += '</div>';
    
    diffDiv.innerHTML = diffHtml;
}

async function updateFileChangesForStash() {
    const fileChangesDiv = document.getElementById('file-changes');
    const panelHeader = fileChangesDiv.previousElementSibling;
    
    // Update header to show "Stash Changes"
    if (panelHeader && panelHeader.classList.contains('panel-header-with-filter')) {
        panelHeader.innerHTML = `
            Stash Changes
            <input type="text" class="filter-input" id="file-filter" placeholder="Filter files..." />
        `;
    }
    
    // Clear file changes initially
    fileChangesDiv.innerHTML = '<p style="padding: 15px; color: #666; font-style: italic;">Select a stash to view changes</p>';
    
    // Clear diff panel
    const diffDiv = document.getElementById('file-diff');
    diffDiv.innerHTML = '<p style="padding: 15px; color: #666; font-style: italic;">Select a file to view changes</p>';
    
    const diffPanelTitle = document.getElementById('diff-panel-title');
    diffPanelTitle.textContent = 'File Diff';
}
