import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';

// Exercise the shipped CSS, including its cascade, with synthetic labels only.
// Build the Web app first. No server, account, network or user data is needed.
const web = fileURLToPath(new URL('../', import.meta.url));
const html = await readFile(path.join(web, 'dist/index.html'), 'utf8');
const stylesheets = [...html.matchAll(/href="([^"]+\.css)"/g)].map(match => match[1]);
assert.ok(stylesheets.length > 0, 'Build the Web app before testing its appearance.');
const css = (await Promise.all(stylesheets.map(file => readFile(path.join(web, 'dist', file.replace(/^\//, '')), 'utf8')))).join('\n');
const themes = ['graphite', 'midnight', 'forest', 'cloud', 'paper', 'contrast'];
const colors = ['#7C8B9A', '#F59E0B', '#EF4444', '#10B981', '#6B7280', '#A855F7', '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF'];
const surfaces = ['bg', 'panel', 'surface', 'surface-raised', 'surface-hover', 'sidebar', 'control', 'accent-dark'];
const browser = await chromium.launch({headless: true, chromiumSandbox: true, ...(process.env.CYTASK_TEST_BROWSER ? {channel: process.env.CYTASK_TEST_BROWSER} : {})});
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 960}, serviceWorkers: 'block'});
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const report = [];
  for (const theme of themes) {
    const light = ['cloud', 'paper'].includes(theme);
    const tokens = surfaces.map(surface => `<div style="background:var(--${surface})">
      <span data-contrast="${surface}/text" style="color:var(--text)">Task title</span>
      <span data-contrast="${surface}/soft" style="color:var(--text-soft)">Project label</span>
      <span class="muted" data-contrast="${surface}/muted">Secondary label</span></div>`).join('');
    const statuses = colors.map(color => `<div class="compact-task-row" style="display:flex">
      <span class="status" style="--status-color:${color}" data-contrast="badge/${color}">Review</span>
      <select class="compact-status-select" style="--status-color:${color}" data-contrast="status/${color}" data-border>
        <option>Review</option></select>
      <div class="quick-status-controls"><select style="--status-color:${color}" data-contrast="detail/${color}" data-border>
        <option style="--status-color:${color}" data-contrast="option/${color}">Review</option></select></div></div>`).join('');
    const priorities = ['low', 'normal', 'high', 'urgent'].map(priority => `<div>
      <span class="priority priority-${priority}" data-contrast="priority-badge/${priority}">${priority}</span>
      <span class="compact-priority priority-${priority}" data-contrast="priority-readonly/${priority}">${priority}</span>
      <select class="compact-priority-select priority-${priority}" data-contrast="priority-select/${priority}" data-border>
        <option data-contrast="priority-option/${priority}">Priority</option></select></div>`).join('');
    await page.setContent(`<style>${css}</style><main class="workspace-shell server-workspace theme-${light ? 'light' : 'dark'} theme-${theme}" style="display:block">
      ${tokens}<div class="sidebar" style="position:static;width:auto;display:block">
        <button class="sidebar-nav-link" data-contrast="navigation">Inbox</button>
        <button class="folder-link"><span>Art</span><small data-contrast="folder-count">14</small></button>
        <div class="space-tree-label" data-contrast="folder-heading">Folders</div>
        <button class="room-link" data-contrast="room">General</button></div>
      <div class="task-pane" style="display:block">
        <div class="compact-table">
          <div class="compact-columns"><button class="compact-column-sort" data-contrast="column-heading">Status</button></div>
          <div class="compact-task-row" style="display:flex">
            <button class="compact-task-name compact-cell-button"><strong data-contrast="task-title">Synthetic task</strong><small data-contrast="task-key">TEST-1</small></button>
            <span class="compact-folder-value" data-contrast="folder-value">Art</span>
            <div class="assignee-picker compact"><details><summary><span></span><span data-contrast="assignee">Demo Member</span></summary></details></div>
            <input class="compact-due-input" value="2030-01-01" type="date" data-contrast="date" data-border>
          </div>${statuses}${priorities}
          <input placeholder="Filter tasks" data-placeholder data-border>
        </div><div class="task-main"><small data-contrast="list-summary">Task summary</small></div>
        <div class="board-card"><footer class="board-card-footer"><time data-contrast="board-date">Tomorrow</time></footer></div>
      </div></main>`);
    const measureAppearance = () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', {willReadFrequently: true});
      function rgba(color) {
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        const pixel = ctx.getImageData(0, 0, 1, 1).data; return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
      }
      function over(front, back) {return front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3]));}
      function background(element) {
        const layers = []; for (let node = element; node; node = node.parentElement) layers.push(rgba(getComputedStyle(node).backgroundColor));
        return layers.reverse().reduce((back, front) => over(front, back), [255, 255, 255]);
      }
      function luminance(rgb) {
        const linear = rgb.map(value => {value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;});
        return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
      }
      function ratio(front, back) {const a = luminance(front), b = luminance(back); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);}
      const results = [...document.querySelectorAll('[data-contrast]')].map(element => {
        const style = getComputedStyle(element), bg = background(element);
        return {name: element.dataset.contrast, kind: 'text', color: style.color, background: bg, ratio: ratio(over(rgba(style.color), bg), bg)};
      });
      for (const element of document.querySelectorAll('[data-border]')) {
        const border = rgba(getComputedStyle(element).borderTopColor);
        for (const [kind, bg] of [['control', background(element)], ['surround', background(element.parentElement)]])
          results.push({name: element.dataset.contrast ?? 'input', kind: `border/${kind}`, ratio: ratio(over(border, bg), bg)});
      }
      const input = document.querySelector('[data-placeholder]'), placeholder = getComputedStyle(input, '::placeholder'), bg = background(input);
      const ink = rgba(placeholder.color); ink[3] *= Number(placeholder.opacity);
      results.push({name: 'placeholder', kind: 'text', ratio: ratio(over(ink, bg), bg)});
      for (const element of document.querySelectorAll(':focus-visible')) {
        const style = getComputedStyle(element), bg = background(element.parentElement);
        if (style.outlineStyle !== 'none') results.push({name: 'focus', kind: 'outline', ratio: ratio(over(rgba(style.outlineColor), bg), bg)});
      }
      return results;
    };
    const checks = await page.evaluate(measureAppearance);
    const failed = checks.filter(check => check.ratio < (check.kind === 'text' ? 4.5 : 3));
    assert.deepEqual(failed, [], `${theme}: normal text must reach 4.5:1; control boundaries 3:1.\n${JSON.stringify(failed, null, 2)}`);
    const size = await page.locator('.compact-task-name strong').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
    assert.ok(size >= 12, `${theme}: task titles must remain readable at compact density.`);
    // Recheck real hover/selection styles as well as the neutral palette tokens.
    for (const selector of ['.compact-task-row', '.sidebar-nav-link', '.room-link']) {
      await page.locator(selector).first().hover();
      checks.push(...await page.evaluate(measureAppearance));
    }
    await page.locator('.compact-task-row').first().evaluate(element => element.classList.add('active'));
    checks.push(...await page.evaluate(measureAppearance));
    await page.locator('.compact-status-select').first().focus();
    assert.equal(await page.locator('.compact-status-select').first().evaluate(element => getComputedStyle(element).outlineWidth), '2px');
    checks.push(...await page.evaluate(measureAppearance));
    assert.deepEqual(checks.filter(check => check.ratio < (check.kind === 'text' ? 4.5 : 3)), [], `${theme}: hover, selection and keyboard focus must retain contrast.`);
    report.push({theme, checks: checks.length, minimumTextContrast: Number(Math.min(...checks.filter(check => check.kind === 'text').map(check => check.ratio)).toFixed(2))});
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({appearance: report}));
} finally {await browser.close();}
