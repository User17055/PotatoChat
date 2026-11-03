// Teste da interface real (PHP e Node) em desktop e celular, sem contas ou banco de produção.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright-core");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
try {
  for (const variant of ["php", "node"]) {
    if (process.env.EMOJI_VARIANT && process.env.EMOJI_VARIANT !== variant) continue;
    const directory = path.join(root, variant === "php" ? "versao-php/site" : "public");
    const html = variant === "php" ? execFileSync("php", [path.join(directory, "index.php")]) : await fs.readFile(path.join(directory, "index.html"));
    const server = http.createServer(async (req, res) => {
      const route = new URL(req.url, "http://localhost").pathname;
      if (route.startsWith("/api")) { res.setHeader("Content-Type", "application/json"); res.end('{"people":2,"seats":0}'); return; }
      if (route === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html); return; }
      const file = route === "/socket.io/socket.io.js" ? path.join(root, "node_modules/socket.io-client/dist/socket.io.min.js")
        : path.resolve(directory, "." + decodeURIComponent(route));
      if (!file.startsWith(directory + path.sep) && !route.startsWith("/socket.io/")) { res.writeHead(403); res.end(); return; }
      try {
        res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream");
        res.end(await fs.readFile(file));
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      for (const mobile of [false, true]) {
        const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
        await context.route(/^https:\/\//, (route) => route.abort());
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.waitForSelector("#emoji-panel", { state: "attached" });
        const showChat = async () => page.evaluate(() => {
          document.querySelector("#login-view").classList.add("hidden");
          document.querySelector("#chat-view").classList.remove("hidden");
          document.querySelector("#room-title").textContent = "Conversa de teste";
          window.submits = 0;
          document.querySelector("#message-form").addEventListener("submit", () => window.submits++, true);
        });
        await showChat();
        const button = page.locator("#emoji-button"), panel = page.locator("#emoji-panel"), input = page.locator("#message-input"), search = panel.locator(".emoji-search");
        await input.fill("Oi, tudo bem?");
        await input.evaluate((node) => node.setSelectionRange(4, 8));
        await button.click();
        assert.ok(await panel.isVisible());
        assert.ok(await panel.locator(".emoji-choice").count() > 60);
        assert.equal(await button.getAttribute("aria-expanded"), "true");
        const rect = await panel.boundingBox();
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= (mobile ? 390 : 1280), JSON.stringify({ variant, mobile, rect, form: await page.locator("#message-form").boundingBox() }));
        if (variant === "php") {
          await fs.mkdir(path.join(root, "dist"), { recursive: true });
          await page.screenshot({ path: path.join(root, `dist/emoji-picker-${mobile ? "mobile" : "desktop"}.png`) });
        }
        await search.fill("coração");
        assert.ok(await panel.locator(".emoji-choice").count() >= 20);
        await search.press("Enter");
        assert.equal(await page.evaluate(() => window.submits), 0);
        await panel.locator('.emoji-choice[data-emoji="❤️"]').click();
        await panel.locator('.emoji-choice[data-emoji="🩷"]').click();
        assert.equal(await input.inputValue(), "Oi, ❤️🩷 bem?");
        assert.equal(await page.locator("#messages .message").count(), 0);
        await input.evaluate((node) => { node.maxLength = node.value.length; });
        await panel.locator('.emoji-choice[data-emoji="💜"]').click();
        assert.equal(await input.inputValue(), "Oi, ❤️🩷 bem?");
        await input.evaluate((node) => { node.maxLength = 2000; });
        await search.fill("xyzsemresultado");
        assert.equal(await panel.locator(".emoji-choice").count(), 0);
        assert.ok(await panel.locator(".emoji-empty").isVisible());
        await page.keyboard.press("Escape");
        assert.ok(await panel.isHidden());
        await button.click();
        await panel.getByRole("tab", { name: "Recentes", exact: true }).click();
        assert.equal(await panel.locator(".emoji-choice").count(), 2);
        await page.keyboard.press("ArrowRight");
        assert.equal(await panel.getByRole("tab", { name: "Rostos", exact: true }).getAttribute("aria-selected"), "true");
        await page.locator("#room-title").click();
        assert.ok(await panel.isHidden());
        await page.reload();
        await page.waitForSelector("#emoji-panel", { state: "attached" });
        await showChat();
        await button.click();
        assert.equal(await panel.locator(".emoji-choice").count(), 2);
        assert.deepEqual(errors, []);
        console.log(`${variant}/${mobile ? "celular" : "desktop"}: grade, busca, cursor, vários emojis, limite, recentes, teclado e fechamento aprovados.`);
        await context.close();
      }
    } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  }
} finally { await browser.close(); }
