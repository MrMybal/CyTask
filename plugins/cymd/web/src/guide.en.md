# Welcome to CyMD

CyMD is a **Markdown** notepad: write plain text and see it formatted *live*. Syntax stays hidden in Live, including while selecting text. Use Raw or Side by side to edit markup or table structure.

## Four views

- **Live** (Ctrl+1): formatted text while you type.
- **Side by side** (Ctrl+2): Markdown source on the left, preview on the right.
- **Source** (Ctrl+3): plain Markdown text.
- **Read** (Ctrl+4): read without editing. Double-click to return to the editor.

## Tabs

Use Ctrl+T for a new tab, Ctrl+W to close it and Ctrl+Tab to switch tabs.
Drag a tab to reorder it, move it to another CyMD window, or drag it out to create a new window.
Files opened from your file manager appear in the existing window.

## Formatting

The toolbar provides file and formatting commands. Select text to show the floating formatting toolbar.

**Bold** (Ctrl+B), *italic* (Ctrl+I), <u>underline</u> (Ctrl+U), ~~strikethrough~~ (Ctrl+Shift+X) and `code` (Ctrl+E).
A ||spoiler|| is revealed on hover or click. Use HTML for <mark>highlights</mark> and <kbd>Ctrl</kbd> key labels.
Create a [link](https://en.wikipedia.org/wiki/Markdown) with Ctrl+K; Ctrl+click opens it.
The **#** button toggles line numbers.

> Start a quote with `>`.
> Quotes can span several lines.

1. Numbered lists continue with Enter
2. Indent with Tab
   - Nested bullet

- [x] Completed task
- [ ] Click the checkbox to complete a task

| Shortcut | Action |
| --- | --- |
| Ctrl+S | Save |
| Ctrl+T / Ctrl+W | New tab / close tab |
| Ctrl+Shift+V | Paste as plain text |
| Ctrl+F | Find / replace |

```js
// Code blocks use syntax highlighting
const hello = (name) => `Hello ${name}!`
```

## Media and clipboard

- Paste images or screenshots into the document.
- Drop images, videos or files into the window.
- Paste content from a web page or Word to convert it to Markdown.
- Paste a URL over selected text to make a link.
- Set an image width with `![description|300](image.png)`.

## Link previews

Paste a URL on its own line to show a link preview. Wrap it in angle brackets, such as
<https://en.wikipedia.org/wiki/Markdown>, to suppress the preview.

## File formats

- **.md**: plain Markdown; local media lives beside the document in its folder.
- **.cymd**: an all-in-one ZIP containing Markdown, media and cached link previews.

Use **Save as** to switch formats. HTML export embeds media for a standalone document.

## Language and updates

Choose **Français** or **English** in the toolbar, or in **View → Language** on desktop.
**Help → Check for updates** checks stable GitHub releases in the installed Windows version.
