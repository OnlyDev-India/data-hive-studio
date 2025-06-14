# Command Palette

A VS Code-style command palette for Data Hive Studio that provides quick access to all application features, navigation, file management, and settings.

## Features

### 🚀 Quick Access
- **Keyboard Shortcut**: `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
- **Click Access**: Click the search icon in the sidebar
- **Smart Search**: Fuzzy search with multi-word support

### 📂 Navigation Commands
- **Go to Home**: Navigate to the connection page
- **Go to Editor**: Navigate to the database editor (`Ctrl+Shift+T`)
- **Go to Schema Visualizer**: Navigate to the schema visualizer (`Ctrl+Shift+V`)

### 📄 File Management
- **New Query File**: Create a new SQL query file (`Ctrl+N`)
- **Create New Table**: Open the table creation interface
- **Open Files**: Switch between open files quickly
- **Close Files**: Close any open file (`Ctrl+W` for current file)

### 🗃️ Table Operations
- **View Table Data**: Open any table for data viewing
- **View Table Structure**: Inspect table schema and structure
- **Search Tables**: Filter through all available database tables

### 🎨 Theme Management
- **Switch to Light Theme**: Change to light mode
- **Switch to Dark Theme**: Change to dark mode
- **Use System Theme**: Follow system theme preferences

### ⚡ Quick Actions
- **Reload Tables**: Refresh the table list
- **Disconnect Database**: Safely disconnect from current database (`Ctrl+Q`)

## Usage

### Opening the Command Palette
1. **Keyboard**: Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. **Mouse**: Click the search icon in the left sidebar
3. The palette will open at the top of the screen

### Searching Commands
- Type to search through all available commands
- Supports fuzzy search (e.g., "new file" will find "New Query File")
- Use space to search multiple words
- Commands are grouped by category for easy browsing

### Executing Commands
- **Keyboard**: Use arrow keys to navigate, Enter to execute
- **Mouse**: Click on any command to execute it
- The palette will close automatically after execution

## Command Categories

### Navigation
Commands for moving between different pages and views in the application.

### Files
File creation, opening, and management commands for working with queries and tables.

### Close Files
Quick access to close any currently open file or tab.

### Tables
Database table operations including viewing data and inspecting structure.

### Quick Actions
Frequently used operations for faster workflow.

### Theme
Appearance settings and theme switching options.

### System
Application-level commands like database disconnection.

## Keyboard Shortcuts Reference

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` | Open Command Palette |
| `Ctrl+Shift+T` | Go to Editor |
| `Ctrl+Shift+V` | Go to Schema Visualizer |
| `Ctrl+N` | New Query File |
| `Ctrl+W` | Close Current Tab |
| `Ctrl+Q` | Disconnect Database |
| `Ctrl+Enter` | Run Query (in editor) |

## Implementation Details

The command palette is built using:
- **React Components**: Modern React with hooks
- **Command UI**: Uses `cmdk` for the command interface
- **Redux Integration**: Connected to application state
- **Next.js Router**: For navigation commands
- **Theme Provider**: For theme switching
- **Keyboard Hooks**: Custom keyboard shortcut handling

## Benefits

- **Faster Navigation**: No need to use mouse for common actions
- **Discoverable**: All features accessible from one place
- **Efficient**: Fuzzy search finds commands quickly
- **Consistent**: Familiar VS Code-style interface
- **Accessible**: Keyboard-first design with mouse support

## Future Enhancements

- Recent commands history
- Custom user-defined commands
- Command execution context awareness
- Advanced filtering and sorting options
- Command aliases and shortcuts customization 