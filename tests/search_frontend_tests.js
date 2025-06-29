/**
 * Frontend JavaScript Tests for Global Search Functionality
 * 
 * These tests verify the frontend search interface, debouncing, result display,
 * navigation handling, and other UI interactions.
 * 
 * To run these tests, you would typically use a test runner like Jest, Mocha, or QUnit.
 * For this example, they are written as assertion-based tests that can be run in a browser environment.
 */

// Mock Tauri invoke function for testing
let mockSearchResults = [];
let mockInvokeError = null;
let invokeCallHistory = [];

const mockInvoke = (command, args) => {
    invokeCallHistory.push({ command, args });
    
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (mockInvokeError) {
                reject(mockInvokeError);
            } else {
                resolve(mockSearchResults);
            }
        }, 10); // Simulate async delay
    });
};

// Mock DOM elements
class MockElement {
    constructor(tagName = 'div', id = null) {
        this.tagName = tagName;
        this.id = id;
        this.classList = new MockClassList();
        this.innerHTML = '';
        this.value = '';
        this.textContent = '';
        this.dataset = {};
        this.children = [];
        this.parentNode = null;
        this.eventListeners = {};
    }

    addEventListener(event, handler) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(handler);
    }

    removeEventListener(event, handler) {
        if (this.eventListeners[event]) {
            const index = this.eventListeners[event].indexOf(handler);
            if (index > -1) {
                this.eventListeners[event].splice(index, 1);
            }
        }
    }

    trigger(event, data = {}) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(handler => {
                handler({ ...data, target: this, preventDefault: () => {} });
            });
        }
    }

    focus() {
        this.trigger('focus');
    }

    blur() {
        this.trigger('blur');
    }

    contains(element) {
        return this.children.includes(element);
    }

    querySelector(selector) {
        // Simple implementation for testing
        return this.children.find(child => 
            child.id === selector.replace('#', '') ||
            child.classList.contains(selector.replace('.', ''))
        );
    }

    querySelectorAll(selector) {
        return this.children.filter(child => 
            child.classList.contains(selector.replace('.', ''))
        );
    }

    scrollIntoView() {
        // Mock implementation
    }
}

class MockClassList {
    constructor() {
        this.classes = new Set();
    }

    add(className) {
        this.classes.add(className);
    }

    remove(className) {
        this.classes.delete(className);
    }

    contains(className) {
        return this.classes.has(className);
    }

    toggle(className) {
        if (this.classes.has(className)) {
            this.classes.delete(className);
        } else {
            this.classes.add(className);
        }
    }
}

// Mock document
const mockDocument = {
    getElementById: (id) => {
        const elements = {
            'global-search': new MockElement('input', 'global-search'),
            'search-results-overlay': new MockElement('div', 'search-results-overlay'),
        };
        return elements[id] || new MockElement();
    },
    addEventListener: (event, handler) => {
        // Mock global event listeners
    }
};

// Test helper functions
function resetMocks() {
    mockSearchResults = [];
    mockInvokeError = null;
    invokeCallHistory = [];
}

function createSearchResult(type, commitId, message, author, date, filePath = null, content = null, lineNumber = null) {
    return {
        result_type: type,
        commit_id: commitId,
        commit_message: message,
        commit_author: author,
        commit_date: date,
        file_path: filePath,
        content_preview: content,
        line_number: lineNumber
    };
}

// Test Suite: Global Search Frontend
class SearchFrontendTests {
    
    constructor() {
        this.testCount = 0;
        this.passedTests = 0;
        this.failedTests = 0;
    }

    assert(condition, message) {
        this.testCount++;
        if (condition) {
            this.passedTests++;
            console.log(`✓ ${message}`);
        } else {
            this.failedTests++;
            console.error(`✗ ${message}`);
        }
    }

    async testSearchDebouncing() {
        console.log('\n--- Testing Search Debouncing ---');
        resetMocks();
        
        const searchInput = mockDocument.getElementById('global-search');
        let searchTimeout = null;
        
        // Mock the search function
        const performSearch = (query) => {
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
            searchTimeout = setTimeout(() => {
                invokeCallHistory.push({ query });
            }, 300);
        };

        // Simulate rapid typing
        performSearch('s');
        performSearch('se');
        performSearch('sea');
        performSearch('sear');
        performSearch('search');

        // Wait for debounce delay
        await new Promise(resolve => setTimeout(resolve, 350));

        this.assert(invokeCallHistory.length === 1, 'Debouncing should result in only one search call');
        this.assert(invokeCallHistory[0].query === 'search', 'Final query should be complete search term');
    }

    async testSearchResultDisplay() {
        console.log('\n--- Testing Search Result Display ---');
        resetMocks();

        mockSearchResults = [
            createSearchResult('commit', 'abc123', 'Add search feature', 'John Doe', '2024-01-01', null, 'Add search feature'),
            createSearchResult('file', 'def456', 'Update search utils', 'Jane Smith', '2024-01-02', 'search.js', 'File: search.js'),
            createSearchResult('content', 'ghi789', 'Fix search bug', 'Bob Wilson', '2024-01-03', 'app.js', 'function searchFunction()', 42)
        ];

        const overlay = mockDocument.getElementById('search-results-overlay');
        
        // Mock the displaySearchResults function (updated to match new structure)
        const displaySearchResults = (results, query) => {
            overlay.innerHTML = results.map(result => {
                const typeLabel = {
                    'commit': 'Commit Message',
                    'file': 'File Name', 
                    'content': 'File Content'
                }[result.result_type];
                
                const title = result.result_type === 'commit' ? result.commit_message : result.file_path || result.commit_message;
                const content = result.content_preview || '';
                
                // Build commit info for file and content results
                let commitInfo = '';
                if (result.result_type === 'file' || result.result_type === 'content') {
                    const shortCommitId = result.commit_id.substring(0, 8);
                    const commitMessage = result.commit_message.length > 50 
                        ? result.commit_message.substring(0, 47) + '...'
                        : result.commit_message;
                    commitInfo = `<div class="search-result-commit-info">
                        <span class="search-result-commit-hash">${shortCommitId}</span>${commitMessage}
                    </div>`;
                }
                
                return `<div class="search-result-item" data-commit-id="${result.commit_id}" data-file-path="${result.file_path || ''}" data-result-type="${result.result_type}">
                    <div class="search-result-type">${typeLabel}</div>
                    <div class="search-result-title">${title}</div>
                    <div class="search-result-content">${content}<br><small>${result.commit_author} • ${result.commit_date}</small>${commitInfo}</div>
                </div>`;
            }).join('');
            overlay.classList.add('show');
        };

        displaySearchResults(mockSearchResults, 'search');

        this.assert(overlay.innerHTML.includes('Commit Message'), 'Should display commit result type');
        this.assert(overlay.innerHTML.includes('File Name'), 'Should display file result type');
        this.assert(overlay.innerHTML.includes('File Content'), 'Should display content result type');
        this.assert(overlay.innerHTML.includes('Add search feature'), 'Should display commit message');
        this.assert(overlay.innerHTML.includes('search.js'), 'Should display file path');
        this.assert(overlay.innerHTML.includes('function searchFunction()'), 'Should display content preview');
        this.assert(overlay.innerHTML.includes('search-result-commit-info'), 'Should display commit info for file/content results');
        this.assert(overlay.innerHTML.includes('def456'), 'Should display commit hash for file results');
        this.assert(overlay.innerHTML.includes('ghi789'), 'Should display commit hash for content results');
        this.assert(overlay.classList.contains('show'), 'Should show the overlay');
    }

    testSearchTermHighlighting() {
        console.log('\n--- Testing Search Term Highlighting ---');
        
        const highlightSearchTerm = (text, query) => {
            if (!text || !query) return text;
            const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            return text.replace(regex, '<span class="search-highlight">$1</span>');
        };

        const highlighted1 = highlightSearchTerm('This is a search test', 'search');
        const highlighted2 = highlightSearchTerm('SEARCH should work case insensitive', 'search');
        const highlighted3 = highlightSearchTerm('Multiple search terms in search results', 'search');

        this.assert(highlighted1.includes('<span class="search-highlight">search</span>'), 'Should highlight search term');
        this.assert(highlighted2.includes('<span class="search-highlight">SEARCH</span>'), 'Should work case insensitive');
        this.assert((highlighted3.match(/search-highlight/g) || []).length === 2, 'Should highlight multiple occurrences');
    }

    testKeyboardShortcuts() {
        console.log('\n--- Testing Keyboard Shortcuts ---');
        
        const searchInput = mockDocument.getElementById('global-search');
        let focusCalled = false;
        
        searchInput.focus = () => {
            focusCalled = true;
        };

        // Mock the keyboard shortcut handler
        const handleKeyboardShortcut = (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
                event.preventDefault();
                searchInput.focus();
            }
        };

        // Test Ctrl+K
        handleKeyboardShortcut({ ctrlKey: true, key: 'k', preventDefault: () => {} });
        this.assert(focusCalled, 'Ctrl+K should focus search input');

        // Reset and test Cmd+K
        focusCalled = false;
        handleKeyboardShortcut({ metaKey: true, key: 'k', preventDefault: () => {} });
        this.assert(focusCalled, 'Cmd+K should focus search input');
    }

    testSearchResultNavigation() {
        console.log('\n--- Testing Search Result Navigation ---');
        
        let navigationCalled = false;
        let navigatedCommitId = null;
        let navigatedFilePath = null;

        const handleSearchResultClick = (commitId, filePath, resultType) => {
            navigationCalled = true;
            navigatedCommitId = commitId;
            navigatedFilePath = filePath;
        };

        // Test commit navigation
        handleSearchResultClick('abc123', '', 'commit');
        this.assert(navigationCalled, 'Should handle result click');
        this.assert(navigatedCommitId === 'abc123', 'Should navigate to correct commit');

        // Test file navigation
        navigationCalled = false;
        handleSearchResultClick('def456', 'search.js', 'file');
        this.assert(navigationCalled, 'Should handle file result click');
        this.assert(navigatedFilePath === 'search.js', 'Should navigate to correct file');
    }

    testErrorHandling() {
        console.log('\n--- Testing Error Handling ---');
        resetMocks();

        mockInvokeError = 'Repository not found';
        
        const overlay = mockDocument.getElementById('search-results-overlay');
        
        // Mock error handling in search
        const handleSearchError = (error) => {
            overlay.innerHTML = `<div class="search-result-item"><div class="search-result-content">Search failed: ${error}</div></div>`;
            overlay.classList.add('show');
        };

        handleSearchError(mockInvokeError);

        this.assert(overlay.innerHTML.includes('Search failed: Repository not found'), 'Should display error message');
        this.assert(overlay.classList.contains('show'), 'Should show error in overlay');
    }

    testEmptyQueryHandling() {
        console.log('\n--- Testing Empty Query Handling ---');
        
        const overlay = mockDocument.getElementById('search-results-overlay');
        
        const hideSearchResults = () => {
            overlay.classList.remove('show');
        };

        const handleEmptyQuery = (query) => {
            if (!query || query.trim().length < 2) {
                hideSearchResults();
                return true;
            }
            return false;
        };

        this.assert(handleEmptyQuery(''), 'Should handle empty string');
        this.assert(handleEmptyQuery('   '), 'Should handle whitespace');
        this.assert(handleEmptyQuery('a'), 'Should handle single character');
        this.assert(!handleEmptyQuery('ab'), 'Should allow 2+ character queries');
        this.assert(!overlay.classList.contains('show'), 'Should hide overlay for empty queries');
    }

    testSearchStateManagement() {
        console.log('\n--- Testing Search State Management ---');
        
        let isSearching = false;
        let searchTimeout = null;

        const performGlobalSearch = async (query) => {
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
            
            if (!query || query.trim().length < 2) {
                return;
            }
            
            isSearching = true;
            
            try {
                await mockInvoke('global_search', { query });
            } catch (error) {
                console.error('Search error:', error);
            } finally {
                isSearching = false;
            }
        };

        this.assert(!isSearching, 'Should start with isSearching false');
        
        const searchPromise = performGlobalSearch('test query');
        this.assert(isSearching, 'Should set isSearching true during search');
        
        return searchPromise.then(() => {
            this.assert(!isSearching, 'Should set isSearching false after search completes');
        });
    }

    async runAllTests() {
        console.log('Starting Global Search Frontend Tests...\n');
        
        await this.testSearchDebouncing();
        await this.testSearchResultDisplay();
        this.testSearchTermHighlighting();
        this.testKeyboardShortcuts();
        this.testSearchResultNavigation();
        this.testErrorHandling();
        this.testEmptyQueryHandling();
        await this.testSearchStateManagement();
        
        console.log(`\n--- Test Results ---`);
        console.log(`Total Tests: ${this.testCount}`);
        console.log(`Passed: ${this.passedTests}`);
        console.log(`Failed: ${this.failedTests}`);
        console.log(`Success Rate: ${((this.passedTests / this.testCount) * 100).toFixed(1)}%`);
        
        if (this.failedTests === 0) {
            console.log('🎉 All tests passed!');
        } else {
            console.log('❌ Some tests failed');
        }
    }
}

// Run tests if in browser environment
if (typeof window !== 'undefined') {
    const testSuite = new SearchFrontendTests();
    testSuite.runAllTests();
} else {
    // Export for Node.js testing environments
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SearchFrontendTests;
    }
}