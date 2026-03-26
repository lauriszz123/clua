"use strict";
const { normalizeApiMap } = require("./api-types");

// LOVE (L�VE2D) API docs for CLua LSP.
// Extend this file with more namespaces/functions to grow completion + hover + signature help.

const LOVE_NAMESPACES = {
  "love": { doc: "L�VE root namespace." },
  "love.event": { doc: "Event queue operations and app quit handling." },
  "love.keyboard": { doc: "Keyboard state and text input helpers." },
  "love.mouse": { doc: "Mouse state, position, cursor, and visibility." },
  "love.joystick": { doc: "Connected joystick/gamepad listing and queries." },
  "love.touch": { doc: "Touch input data and pressure/position queries." },
  "love.graphics": { doc: "Drawing functions (text, images, shapes, transforms, etc.)." },
  "love.image": { doc: "ImageData creation/manipulation utilities." },
  "love.data": { doc: "ByteData and data conversion helpers." },
  "love.sound": { doc: "SoundData loading and creation." },
  "love.window": { doc: "Window creation and display mode configuration." },
  "love.audio": { doc: "Playback control for Source objects and global audio state." },
  "love.filesystem": { doc: "Read/write files in the game save/source environment." },
  "love.timer": { doc: "Timing utilities such as delta time and sleep." },
  "love.math": { doc: "Math helpers and random number generation." },
  "love.physics": { doc: "Physics world and body/fixture/shape constructors." },
  "love.system": { doc: "System info (OS, clipboard, power state, URL opening)." },
  "love.thread": { doc: "Create threads and channels for background work." },
};

const RAW_LOVE_FUNCTIONS = {
  "love.load": {
    signature: "love.load(args: table)",
    doc: "Callback run once on startup (user-defined).",
    params: [{ name: "args", typeName: "table", doc: "Command line args" }],
  },
  "love.update": {
    signature: "love.update(dt: number)",
    doc: "Callback run every frame before drawing (user-defined).",
    params: [{ name: "dt", typeName: "number", doc: "Delta time in seconds" }],
  },
  "love.draw": {
    signature: "love.draw()",
    doc: "Callback run every frame to render visuals (user-defined).",
    params: [],
  },
  "love.keypressed": {
    signature: "love.keypressed(key: string, scancode: string, isrepeat: boolean)",
    doc: "Keyboard press callback (user-defined).",
    params: [
      { name: "key", typeName: "string", doc: "Translated key name" },
      { name: "scancode", typeName: "string", doc: "Physical key identifier" },
      { name: "isrepeat", typeName: "boolean", doc: "Whether this is auto-repeat" },
    ],
  },

  "love.event.quit": {
    signature: "love.event.quit(exitstatus: number)",
    doc: "Requests app quit with optional exit status.",
    params: [{ name: "exitstatus", typeName: "number", doc: "Process exit code" }],
  },
  "love.event.poll": {
    signature: "love.event.poll()",
    doc: "Returns an iterator over pending events.",
    params: [],
  },
  "love.event.pump": {
    signature: "love.event.pump()",
    doc: "Polls OS events and pushes them into LOVE event queue.",
    params: [],
  },

  "love.keyboard.isDown": {
    signature: "love.keyboard.isDown(key: string, ...: string): boolean",
    doc: "Returns true if all provided keys are currently held down.",
    params: [
      { name: "key", typeName: "string", doc: "First key" },
      { name: "...", typeName: "string", doc: "Additional keys" },
    ],
  },
  "love.keyboard.setKeyRepeat": {
    signature: "love.keyboard.setKeyRepeat(enable: boolean)",
    doc: "Enables/disables key repeat events.",
    params: [{ name: "enable", typeName: "boolean", doc: "Enable repeat" }],
  },
  "love.keyboard.hasKeyRepeat": {
    signature: "love.keyboard.hasKeyRepeat(): boolean",
    doc: "Returns whether key repeat is enabled.",
    params: [],
  },

  "love.mouse.getPosition": {
    signature: "love.mouse.getPosition(): number, number",
    doc: "Returns current mouse coordinates.",
    params: [],
  },
  "love.mouse.isDown": {
    signature: "love.mouse.isDown(button: number|string, ...: number|string): boolean",
    doc: "Returns true if specified mouse button(s) are held.",
    params: [
      { name: "button", typeName: "number|string", doc: "First mouse button" },
      { name: "...", typeName: "number|string", doc: "Additional buttons" },
    ],
  },
  "love.mouse.setVisible": {
    signature: "love.mouse.setVisible(visible: boolean)",
    doc: "Shows or hides mouse cursor.",
    params: [{ name: "visible", typeName: "boolean", doc: "Cursor visibility" }],
  },

  "love.graphics.setColor": {
    signature: "love.graphics.setColor(r: number, g: number, b: number, a: number)",
    doc: "Sets the active drawing color.",
    params: [
      { name: "r", typeName: "number", doc: "Red channel" },
      { name: "g", typeName: "number", doc: "Green channel" },
      { name: "b", typeName: "number", doc: "Blue channel" },
      { name: "a", typeName: "number", doc: "Alpha channel" },
    ],
  },
  "love.graphics.clear": {
    signature: "love.graphics.clear(r: number, g: number, b: number, a: number)",
    doc: "Clears current render target with given color.",
    params: [
      { name: "r", typeName: "number", doc: "Red channel" },
      { name: "g", typeName: "number", doc: "Green channel" },
      { name: "b", typeName: "number", doc: "Blue channel" },
      { name: "a", typeName: "number", doc: "Alpha channel" },
    ],
  },
  "love.graphics.print": {
    signature: "love.graphics.print(text: string|number, x: number, y: number, r: number, sx: number, sy: number, ox: number, oy: number, kx: number, ky: number)",
    doc: "Draws text at the specified position.",
    params: [
      { name: "text", typeName: "string|number", doc: "Text/value to draw" },
      { name: "x", typeName: "number", doc: "X position" },
      { name: "y", typeName: "number", doc: "Y position" },
      { name: "r", typeName: "number", doc: "Rotation (radians)" },
      { name: "sx", typeName: "number", doc: "X scale" },
      { name: "sy", typeName: "number", doc: "Y scale" },
      { name: "ox", typeName: "number", doc: "X origin" },
      { name: "oy", typeName: "number", doc: "Y origin" },
      { name: "kx", typeName: "number", doc: "X shear" },
      { name: "ky", typeName: "number", doc: "Y shear" },
    ],
  },
  "love.graphics.newImage": {
    signature: "love.graphics.newImage(filename: string): Image",
    doc: "Creates a drawable Image from a file path.",
    params: [
      { name: "filename", typeName: "string", doc: "Path to image file" },
    ],
  },
  "love.graphics.draw": {
    signature: "love.graphics.draw(drawable: Drawable, [x: number, y: number, r: number, sx: number, sy: number, ox: number, oy: number, kx: number, ky: number])",
    doc: "Draws a Drawable object (Image, Canvas, SpriteBatch, etc.).",
    params: [
      { name: "drawable", typeName: "Drawable", doc: "Object to draw" },
      { name: "x", typeName: "number?", doc: "X position" },
      { name: "y", typeName: "number?", doc: "Y position" },
      { name: "r", typeName: "number?", doc: "Rotation" },
      { name: "sx", typeName: "number?", doc: "X scale" },
      { name: "sy", typeName: "number?", doc: "Y scale" },
      { name: "ox", typeName: "number?", doc: "X origin" },
      { name: "oy", typeName: "number?", doc: "Y origin" },
      { name: "kx", typeName: "number?", doc: "X shear" },
      { name: "ky", typeName: "number?", doc: "Y shear" },
    ],
  },
  "love.graphics.newFont": {
    signature: "love.graphics.newFont(filename: string, size: number): Font",
    doc: "Loads a font from file with optional size.",
    params: [
      { name: "filename", typeName: "string", doc: "Font file path" },
      { name: "size", typeName: "number", doc: "Font size" },
    ],
  },
  "love.graphics.setFont": {
    signature: "love.graphics.setFont(font: Font)",
    doc: "Sets active font used by text drawing functions.",
    params: [{ name: "font", typeName: "Font", doc: "Font object" }],
  },
  "love.graphics.getDimensions": {
    signature: "love.graphics.getDimensions(): number, number",
    doc: "Returns current width and height of active render target/window.",
    params: [],
  },
  "love.graphics.origin": {
    signature: "love.graphics.origin()",
    doc: "Resets current transformation to identity.",
    params: [],
  },
  "love.graphics.push": {
    signature: "love.graphics.push(stacktype: string)",
    doc: "Pushes transform/state stack.",
    params: [{ name: "stacktype", typeName: "string", doc: "all or transform" }],
  },
  "love.graphics.pop": {
    signature: "love.graphics.pop()",
    doc: "Pops transform/state stack.",
    params: [],
  },
  "love.graphics.translate": {
    signature: "love.graphics.translate(x: number, y: number)",
    doc: "Applies translation transform.",
    params: [
      { name: "x", typeName: "number", doc: "X offset" },
      { name: "y", typeName: "number", doc: "Y offset" },
    ],
  },
  "love.graphics.rotate": {
    signature: "love.graphics.rotate(angle: number)",
    doc: "Applies rotation transform.",
    params: [{ name: "angle", typeName: "number", doc: "Rotation in radians" }],
  },
  "love.graphics.scale": {
    signature: "love.graphics.scale(sx: number, sy: number)",
    doc: "Applies scale transform.",
    params: [
      { name: "sx", typeName: "number", doc: "X scale" },
      { name: "sy", typeName: "number", doc: "Y scale" },
    ],
  },
  "love.graphics.rectangle": {
    signature: "love.graphics.rectangle(mode: string, x: number, y: number, w: number, h: number, rx: number, ry: number, segments: number)",
    doc: "Draws a rectangle shape.",
    params: [
      { name: "mode", typeName: "string", doc: "fill or line" },
      { name: "x", typeName: "number", doc: "X position" },
      { name: "y", typeName: "number", doc: "Y position" },
      { name: "w", typeName: "number", doc: "Width" },
      { name: "h", typeName: "number", doc: "Height" },
      { name: "rx", typeName: "number", doc: "Corner radius X" },
      { name: "ry", typeName: "number", doc: "Corner radius Y" },
      { name: "segments", typeName: "number", doc: "Corner segment count" },
    ],
  },

  "love.window.setMode": {
    signature: "love.window.setMode(width: number, height: number, flags: table)",
    doc: "Sets the window dimensions and optional display flags.",
    params: [
      { name: "width", typeName: "number", doc: "Window width" },
      { name: "height", typeName: "number", doc: "Window height" },
      { name: "flags", typeName: "table", doc: "Mode flags (fullscreen, resizable, vsync, etc.)" },
    ],
  },
  "love.window.setTitle": {
    signature: "love.window.setTitle(title: string)",
    doc: "Sets the window title.",
    params: [{ name: "title", typeName: "string", doc: "Title text" }],
  },
  "love.window.getMode": {
    signature: "love.window.getMode(): number, number, table",
    doc: "Returns width, height, and flags table.",
    params: [],
  },

  "love.audio.play": {
    signature: "love.audio.play(source: Source|table)",
    doc: "Plays one or more Source objects.",
    params: [
      { name: "source", typeName: "Source|table", doc: "Audio source(s)" },
    ],
  },
  "love.audio.newSource": {
    signature: "love.audio.newSource(filename: string|SoundData, type: string): Source",
    doc: "Creates a new Source from file or SoundData.",
    params: [
      { name: "filename", typeName: "string|SoundData", doc: "Audio input" },
      { name: "type", typeName: "string", doc: "static or stream" },
    ],
  },
  "love.audio.setVolume": {
    signature: "love.audio.setVolume(volume: number)",
    doc: "Sets global master volume.",
    params: [{ name: "volume", typeName: "number", doc: "0..1" }],
  },
  "love.audio.stop": {
    signature: "love.audio.stop(source: Source|table)",
    doc: "Stops playback for source(s) or all when omitted.",
    params: [{ name: "source", typeName: "Source|table", doc: "Source(s) to stop" }],
  },

  "love.filesystem.read": {
    signature: "love.filesystem.read(filename: string): string",
    doc: "Reads all bytes from a file and returns its content.",
    params: [
      { name: "filename", typeName: "string", doc: "File path" },
    ],
  },
  "love.filesystem.write": {
    signature: "love.filesystem.write(filename: string, data: string|Data, size: number)",
    doc: "Writes data to file in save directory.",
    params: [
      { name: "filename", typeName: "string", doc: "Output file" },
      { name: "data", typeName: "string|Data", doc: "Data to write" },
      { name: "size", typeName: "number", doc: "Optional byte count" },
    ],
  },
  "love.filesystem.getInfo": {
    signature: "love.filesystem.getInfo(path: string, filtertype: string): table",
    doc: "Returns file info table or nil.",
    params: [
      { name: "path", typeName: "string", doc: "File or directory path" },
      { name: "filtertype", typeName: "string", doc: "file, directory, symlink" },
    ],
  },
  "love.filesystem.getDirectoryItems": {
    signature: "love.filesystem.getDirectoryItems(dir: string): table",
    doc: "Returns a list of files/directories within a directory.",
    params: [{ name: "dir", typeName: "string", doc: "Directory path" }],
  },
  "love.filesystem.load": {
    signature: "love.filesystem.load(filename: string): function",
    doc: "Loads a Lua file and returns a callable chunk.",
    params: [{ name: "filename", typeName: "string", doc: "Lua file" }],
  },

  "love.timer.getDelta": {
    signature: "love.timer.getDelta(): number",
    doc: "Returns the time between the last two frames (in seconds).",
    params: [],
  },
  "love.timer.getTime": {
    signature: "love.timer.getTime(): number",
    doc: "Returns current value of high-resolution timer.",
    params: [],
  },
  "love.timer.sleep": {
    signature: "love.timer.sleep(seconds: number)",
    doc: "Sleeps the thread for a short period.",
    params: [{ name: "seconds", typeName: "number", doc: "Sleep duration" }],
  },
  "love.timer.step": {
    signature: "love.timer.step()",
    doc: "Updates internal delta timing state.",
    params: [],
  },

  "love.math.random": {
    signature: "love.math.random([min: number,] max: number): number",
    doc: "Returns a pseudo-random number.",
    params: [
      { name: "min", typeName: "number", doc: "Optional minimum" },
      { name: "max", typeName: "number", doc: "Maximum (or upper bound if min omitted)" },
    ],
  },
  "love.math.randomseed": {
    signature: "love.math.randomseed(seed: number)",
    doc: "Sets random seed for love.math.random.",
    params: [{ name: "seed", typeName: "number", doc: "Seed value" }],
  },
  "love.math.noise": {
    signature: "love.math.noise(x, y, z, w)",
    doc: "Returns simplex noise value.",
    params: [
      { name: "x", typeName: "number", doc: "First coordinate" },
      { name: "y", typeName: "number", doc: "Second coordinate" },
      { name: "z", typeName: "number", doc: "Third coordinate" },
      { name: "w", typeName: "number", doc: "Fourth coordinate" },
    ],
  },

  "love.physics.newWorld": {
    signature: "love.physics.newWorld(gx, gy, sleep)",
    doc: "Creates a new Box2D world.",
    params: [
      { name: "gx", typeName: "number", doc: "Gravity X" },
      { name: "gy", typeName: "number", doc: "Gravity Y" },
      { name: "sleep", typeName: "boolean", doc: "Allow sleeping bodies" },
    ],
  },
  "love.physics.newBody": {
    signature: "love.physics.newBody(world, x, y, type)",
    doc: "Creates a new physics body.",
    params: [
      { name: "world", typeName: "World", doc: "Physics world" },
      { name: "x", typeName: "number", doc: "X position" },
      { name: "y", typeName: "number", doc: "Y position" },
      { name: "type", typeName: "string", doc: "static, dynamic, or kinematic" },
    ],
  },

  "love.system.getOS": {
    signature: "love.system.getOS()",
    doc: "Returns operating system name.",
    params: [],
  },
  "love.system.setClipboardText": {
    signature: "love.system.setClipboardText(text)",
    doc: "Sets clipboard text.",
    params: [{ name: "text", typeName: "string", doc: "Clipboard content" }],
  },
  "love.system.getClipboardText": {
    signature: "love.system.getClipboardText()",
    doc: "Gets clipboard text.",
    params: [],
  },
  "love.system.openURL": {
    signature: "love.system.openURL(url)",
    doc: "Opens URL using system default handler.",
    params: [{ name: "url", typeName: "string", doc: "Target URL" }],
  },

  "love.thread.newThread": {
    signature: "love.thread.newThread(filename)",
    doc: "Creates a thread from Lua file or source code.",
    params: [{ name: "filename", typeName: "string", doc: "Thread script" }],
  },
  "love.thread.getChannel": {
    signature: "love.thread.getChannel(name)",
    doc: "Returns a named Channel object.",
    params: [{ name: "name", typeName: "string", doc: "Channel name" }],
  },
};

const LOVE_FUNCTIONS = normalizeApiMap(RAW_LOVE_FUNCTIONS, "LOVE_FUNCTIONS");

function getLoveChildren(prefix) {
  const needle = `${prefix}.`;
  const seen = new Map();

  for (const key of Object.keys(LOVE_NAMESPACES)) {
    if (!key.startsWith(needle)) {
      continue;
    }

    const rest = key.slice(needle.length);
    const child = rest.split(".")[0];
    if (!child) {
      continue;
    }

    const fullName = `${prefix}.${child}`;
    if (!seen.has(child)) {
      seen.set(child, {
        label: child,
        fullName,
        kind: "namespace",
        detail: fullName,
        doc: LOVE_NAMESPACES[fullName] ? LOVE_NAMESPACES[fullName].doc : "L�VE namespace",
      });
    }
  }

  for (const key of Object.keys(LOVE_FUNCTIONS)) {
    if (!key.startsWith(needle)) {
      continue;
    }

    const rest = key.slice(needle.length);
    if (rest.includes(".")) {
      continue;
    }

    const entry = LOVE_FUNCTIONS[key];
    seen.set(rest, {
      label: rest,
      fullName: key,
      kind: "function",
      detail: entry.signature,
      doc: entry.doc,
    });
  }

  return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function getLoveFunction(fullName) {
  return LOVE_FUNCTIONS[fullName] || null;
}

function getLoveNamespace(fullName) {
  return LOVE_NAMESPACES[fullName] || null;
}

module.exports = {
  LOVE_NAMESPACES,
  LOVE_FUNCTIONS,
  getLoveChildren,
  getLoveFunction,
  getLoveNamespace,
};

