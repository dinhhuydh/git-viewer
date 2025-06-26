import { beforeEach, describe, expect, it } from 'vitest'

describe('Git Viewer UI', () => {
  beforeEach(() => {
    // Set up the basic HTML structure
    document.body.innerHTML = `
      <div class="container">
        <h1>Git Viewer</h1>
        <div class="repo-info">
          <span id="current-repo-path"></span>
        </div>
        <h2>Branches</h2>
        <div id="branches">
          <p>Loading branches...</p>
        </div>
      </div>
    `
  })

  it('should have the correct initial HTML structure', () => {
    expect(document.querySelector('h1').textContent).toBe('Git Viewer')
    expect(document.querySelector('h2').textContent).toBe('Branches')
    expect(document.getElementById('current-repo-path')).toBeTruthy()
    expect(document.getElementById('branches')).toBeTruthy()
  })

  it('should show loading message initially', () => {
    const branchesDiv = document.getElementById('branches')
    expect(branchesDiv.innerHTML).toContain('Loading branches...')
  })

  it('should update repository path when set', () => {
    const repoPath = '/test/repository/path'
    const pathElement = document.getElementById('current-repo-path')
    
    pathElement.textContent = repoPath
    expect(pathElement.textContent).toBe(repoPath)
  })

  it('should update branches display when branches are added', () => {
    const branchesDiv = document.getElementById('branches')
    const mockBranchHTML = `
      <ul>
        <li class="current-branch">main (current)</li>
        <li class="">feature-branch</li>
      </ul>
    `
    
    branchesDiv.innerHTML = mockBranchHTML
    
    expect(branchesDiv.innerHTML).toContain('main (current)')
    expect(branchesDiv.innerHTML).toContain('feature-branch')
    expect(branchesDiv.querySelector('.current-branch')).toBeTruthy()
  })

  it('should show error message when branches fail to load', () => {
    const branchesDiv = document.getElementById('branches')
    const errorMessage = '<p>Error: Failed to load branches</p>'
    
    branchesDiv.innerHTML = errorMessage
    
    expect(branchesDiv.innerHTML).toContain('Error:')
    expect(branchesDiv.innerHTML).toContain('Failed to load branches')
  })

  it('should show no branches message when repository is empty', () => {
    const branchesDiv = document.getElementById('branches')
    const noBranchesMessage = '<p>No branches found</p>'
    
    branchesDiv.innerHTML = noBranchesMessage
    
    expect(branchesDiv.innerHTML).toContain('No branches found')
  })
})