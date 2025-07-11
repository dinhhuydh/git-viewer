# Git Viewer

A modern, fast, and intuitive Git repository viewer built with Tauri (Rust + JavaScript). Experience Git history, file changes, and code diffs with a clean, professional interface designed for developers.

![Git Viewer Screenshot](./assets/screenshot.png)

## ✨ Current Features

### 🎯 Core Functionality
- **Repository Browser** - Open and browse any Git repository
- **Branch Management** - Easy branch selection with dropdown interface
- **Remote Repository Support** - View and switch between Git remotes
- **Commit History** - View detailed commit history with metadata
- **File Changes** - See all files modified in each commit with file type icons
- **Syntax-Highlighted Diffs** - Beautiful code diffs with language-specific highlighting
- **Git Blame View** - See who changed each line with syntax highlighting
- **Recent Repositories** - Quick access to recently opened repositories with auto-restore

### ⌨️ Keyboard Navigation
- **Arrow Key Navigation** - Navigate commits and files using arrow keys
- **Focus Management** - Intuitive focus handling across panels
- **Keyboard Shortcuts** - Home/End for quick jumps, Enter/Space for selection

### 🎨 User Interface
- **4-Panel Layout** - Commits, branches, file changes, and diff view
- **Resizable Panels** - Adjust file panel width from both sides
- **Professional Styling** - Clean, modern interface with hover effects
- **Responsive Design** - Optimized for different screen sizes

### 🔧 Technical Features
- **35+ Language Support** - Syntax highlighting for all major programming languages
- **Memory Efficient** - Smart git operations with proper memory management
- **Cross-Platform** - Native desktop app for macOS, Windows, and Linux
- **Fast Performance** - Rust backend for lightning-fast git operations

## 🚀 Installation

### Prerequisites
- [Rust](https://rustlang.org/) (latest stable)
- [Node.js](https://nodejs.org/) (version 16+)
- Git (for repository operations)

### Build from Source
```bash
# Clone the repository
git clone https://github.com/yourusername/git-viewer.git
cd git-viewer

# Install frontend dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## 📖 Usage

### Getting Started
1. **Open Repository** - Use `File > Open Repository` or `Cmd+O` (macOS) / `Ctrl+O` (Windows/Linux)
2. **Browse Commits** - Select a branch from the dropdown and browse commit history
3. **View Changes** - Click on any commit to see file changes
4. **Inspect Diffs** - Click on files to view detailed diffs with syntax highlighting

### Keyboard Shortcuts
- **Arrow Keys** - Navigate through commits or files
- **Home/End** - Jump to first/last item
- **Tab** - Move focus between panels
- **Enter/Space** - Select current item
- **Cmd+O / Ctrl+O** - Open repository

### Panel Navigation
- **Commits Panel** - Click or use Tab to focus, then arrow keys to navigate
- **File Panel** - Resizable from both sides, keyboard navigation supported
- **Diff Panel** - Automatically updates with syntax-highlighted code

## 🛣️ Roadmap

### 🔥 Must-Have Features (High Priority)

#### Search & Filter
- [x] **Global Search** - Search across commits, files, and content (excludes merge commits)
- [x] **File Name Filtering** - Filter files in changes panel
- [x] **Search Result Navigation** - Click results to navigate to commits and files
- [ ] **Author Filtering** - View commits by specific developers
- [ ] **Date Range Filtering** - Filter commits by time period

#### Enhanced Diff Viewing
- [ ] **Side-by-Side Diff** - Alternative to current unified view
- [ ] **Word-Level Highlighting** - More granular change visualization
- [ ] **Diff Statistics** - Lines added/removed per file
- [ ] **Image Diff Support** - Visual diffs for binary files
- [ ] **Collapsible Hunks** - Expand/collapse sections in large files

#### Performance & Usability
- [ ] **Lazy Loading** - Handle large repositories efficiently
- [ ] **Diff Caching** - Cache computed diffs for faster navigation
- [ ] **Repository Bookmarks** - Extend recent repos with favorites
- [ ] **Keyboard Shortcuts Overlay** - Help menu for shortcuts
- [ ] **Dark Mode Toggle** - Theme switching support

### 🚀 Convenient Features (Medium Priority)

#### Git Operations
- [ ] **Stash Management** - View, apply, and drop stashes

#### Code Intelligence
- [ ] **Jump to Definition** - Navigate to function/class definitions
- [x] **Blame View** - See who changed each line
- [ ] **File History** - Track file changes across branches
- [x] **Copy Commit Hash** - Quick clipboard operations
- [ ] **Export Diff as Patch** - Save changes as patch files

#### Collaboration
- [ ] **Pull Request Integration** - GitHub/GitLab integration
- [ ] **Tag Management** - View and manage Git tags

### ✨ Nice-to-Have Features (Low Priority)

#### Developer Experience
- [ ] **Multi-Repository Workspace** - Multiple repo tabs
- [ ] **Custom Themes** - User-defined color schemes
- [ ] **Plugin System** - Extensible architecture
- [ ] **Export Reports** - PDF/HTML change reports
- [ ] **IDE Integration** - Open files in external editors

#### Advanced Analysis
- [ ] **Code Complexity Metrics** - Complexity analysis per commit
- [ ] **Security Vulnerability Scanning** - Security analysis of changes
- [ ] **License Compliance** - License checking
- [ ] **Code Review Comments** - Annotation system
- [ ] **Performance Impact Analysis** - Performance change analysis

### 🎯 Quick Wins (Easy Implementation)
- [ ] **Copy File Path** - Right-click context menu
- [ ] **Toggle Line Numbers** - Show/hide line numbers in diffs
- [ ] **Commit Link Sharing** - Deep links to specific commits
- [ ] **Auto-Refresh** - Detect repository changes
- [ ] **Fullscreen Diff Mode** - Maximize diff panel
- [ ] **File Type Icons** - Visual file type indicators
- [ ] **Markdown Commit Messages** - Rich text formatting
- [ ] **Diff Line Highlighting** - Hover effects

### 🏆 Standout Features (Unique Value)
- [ ] **AI-Powered Commit Summaries** - Generate human-readable summaries
- [ ] **Code Review Workflow** - Built-in review system
- [ ] **Time-Travel Debugging** - Step through code changes over time
- [ ] **Impact Analysis** - Show affected features/modules

## 🛠️ Technology Stack

### Backend (Rust)
- **Tauri** - Desktop app framework
- **git2** - Git operations library
- **serde** - Serialization framework
- **chrono** - Date/time handling

### Frontend (JavaScript)
- **Vanilla JavaScript** - No framework dependencies
- **Prism.js** - Syntax highlighting
- **CSS Grid/Flexbox** - Modern layout
- **Web APIs** - File system access via Tauri

### Development Tools
- **Vite** - Frontend build tool
- **ESLint** - Code linting
- **Cargo** - Rust package manager

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and test thoroughly
4. Commit with descriptive messages
5. Push and create a Pull Request

### Code Style
- Follow Rust conventions for backend code
- Use ESLint configuration for frontend code
- Write descriptive commit messages
- Add tests for new features

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙋 Support

- **Issues** - Report bugs or request features on [GitHub Issues](https://github.com/yourusername/git-viewer/issues)
- **Discussions** - Join conversations on [GitHub Discussions](https://github.com/yourusername/git-viewer/discussions)
- **Documentation** - Check our [Wiki](https://github.com/yourusername/git-viewer/wiki) for detailed guides

## 🌟 Acknowledgments

- [Tauri](https://tauri.app/) - For the amazing desktop app framework
- [git2](https://github.com/rust-lang/git2-rs) - For robust Git operations in Rust
- [Prism.js](https://prismjs.com/) - For beautiful syntax highlighting
- [Contributors](https://github.com/yourusername/git-viewer/contributors) - Thank you to all contributors!

---

**Made with ❤️ by developers, for developers**

*Transform your Git workflow with a modern, intuitive interface that makes code review and repository exploration a pleasure.*
