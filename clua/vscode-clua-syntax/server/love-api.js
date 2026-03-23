"use strict";

// LOVE (LÖVE2D) API docs for CLua LSP.
// Extend this file with more namespaces/functions to grow completion + hover + signature help.

const LOVE_NAMESPACES = {
  "love": { doc: "LÖVE root namespace." },
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

const LOVE_FUNCTIONS = {
  "love.load": {
    signature: "love.load(args)",
    doc: "Callback run once on startup (user-defined).",
    params: [{ name: "args", typeName: "table", description: "Command line args" }],
  },
  "love.update": {
    signature: "love.update(dt)",
    doc: "Callback run every frame before drawing (user-defined).",
    params: [{ name: "dt", typeName: "number", description: "Delta time in seconds" }],
  },
  "love.draw": {
    signature: "love.draw()",
    doc: "Callback run every frame to render visuals (user-defined).",
    params: [],
  },
  "love.keypressed": {
    signature: "love.keypressed(key, scancode, isrepeat)",
    doc: "Keyboard press callback (user-defined).",
    params: [
      { name: "key", typeName: "string", description: "Translated key name" },
      { name: "scancode", typeName: "string", description: "Physical key identifier" },
      { name: "isrepeat", typeName: "boolean", description: "Whether this is auto-repeat" },
    ],
  },

  "love.event.quit": {
    signature: "love.event.quit(exitstatus)",
    doc: "Requests app quit with optional exit status.",
    params: [{ name: "exitstatus", typeName: "number", description: "Process exit code" }],
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
    signature: "love.keyboard.isDown(key, ...)",
    doc: "Returns true if all provided keys are currently held down.",
    params: [
      { name: "key", typeName: "string", description: "First key" },
      { name: "...", typeName: "string", description: "Additional keys" },
    ],
  },
  "love.keyboard.setKeyRepeat": {
    signature: "love.keyboard.setKeyRepeat(enable)",
    doc: "Enables/disables key repeat events.",
    params: [{ name: "enable", typeName: "boolean", description: "Enable repeat" }],
  },
  "love.keyboard.hasKeyRepeat": {
    signature: "love.keyboard.hasKeyRepeat()",
    doc: "Returns whether key repeat is enabled.",
    params: [],
  },

  "love.mouse.getPosition": {
    signature: "love.mouse.getPosition()",
    doc: "Returns current mouse coordinates.",
    params: [],
  },
  "love.mouse.isDown": {
    signature: "love.mouse.isDown(button, ...)",
    doc: "Returns true if specified mouse button(s) are held.",
    params: [
      { name: "button", typeName: "number|string", description: "First mouse button" },
      { name: "...", typeName: "number|string", description: "Additional buttons" },
    ],
  },
  "love.mouse.setVisible": {
    signature: "love.mouse.setVisible(visible)",
    doc: "Shows or hides mouse cursor.",
    params: [{ name: "visible", typeName: "boolean", description: "Cursor visibility" }],
  },

  "love.graphics.setColor": {
    signature: "love.graphics.setColor(r, g, b, a)",
    doc: "Sets the active drawing color.",
    params: [
      { name: "r", typeName: "number", description: "Red channel" },
      { name: "g", typeName: "number", description: "Green channel" },
      { name: "b", typeName: "number", description: "Blue channel" },
      { name: "a", typeName: "number", description: "Alpha channel" },
    ],
  },
  "love.graphics.clear": {
    signature: "love.graphics.clear(r, g, b, a)",
    doc: "Clears current render target with given color.",
    params: [
      { name: "r", typeName: "number", description: "Red channel" },
      { name: "g", typeName: "number", description: "Green channel" },
      { name: "b", typeName: "number", description: "Blue channel" },
      { name: "a", typeName: "number", description: "Alpha channel" },
    ],
  },
  "love.graphics.print": {
    signature: "love.graphics.print(text, x, y, r, sx, sy, ox, oy, kx, ky)",
    doc: "Draws text at the specified position.",
    params: [
      { name: "text", typeName: "string|number", description: "Text/value to draw" },
      { name: "x", typeName: "number", description: "X position" },
      { name: "y", typeName: "number", description: "Y position" },
      { name: "r", typeName: "number", description: "Rotation (radians)" },
      { name: "sx", typeName: "number", description: "X scale" },
      { name: "sy", typeName: "number", description: "Y scale" },
      { name: "ox", typeName: "number", description: "X origin" },
      { name: "oy", typeName: "number", description: "Y origin" },
      { name: "kx", typeName: "number", description: "X shear" },
      { name: "ky", typeName: "number", description: "Y shear" },
    ],
  },
  "love.graphics.newImage": {
    signature: "love.graphics.newImage(filename)",
    doc: "Creates a drawable Image from a file path.",
    params: [
      { name: "filename", typeName: "string", description: "Path to image file" },
    ],
  },
  "love.graphics.draw": {
    signature: "love.graphics.draw(drawable, x, y, r, sx, sy, ox, oy, kx, ky)",
    doc: "Draws a Drawable object (Image, Canvas, SpriteBatch, etc.).",
    params: [
      { name: "drawable", typeName: "Drawable", description: "Object to draw" },
      { name: "x", typeName: "number", description: "X position" },
      { name: "y", typeName: "number", description: "Y position" },
      { name: "r", typeName: "number", description: "Rotation" },
      { name: "sx", typeName: "number", description: "X scale" },
      { name: "sy", typeName: "number", description: "Y scale" },
      { name: "ox", typeName: "number", description: "X origin" },
      { name: "oy", typeName: "number", description: "Y origin" },
      { name: "kx", typeName: "number", description: "X shear" },
      { name: "ky", typeName: "number", description: "Y shear" },
    ],
  },
  "love.graphics.newFont": {
    signature: "love.graphics.newFont(filename, size)",
    doc: "Loads a font from file with optional size.",
    params: [
      { name: "filename", typeName: "string", description: "Font file path" },
      { name: "size", typeName: "number", description: "Font size" },
    ],
  },
  "love.graphics.setFont": {
    signature: "love.graphics.setFont(font)",
    doc: "Sets active font used by text drawing functions.",
    params: [{ name: "font", typeName: "Font", description: "Font object" }],
  },
  "love.graphics.getDimensions": {
    signature: "love.graphics.getDimensions()",
    doc: "Returns current width and height of active render target/window.",
    params: [],
  },
  "love.graphics.origin": {
    signature: "love.graphics.origin()",
    doc: "Resets current transformation to identity.",
    params: [],
  },
  "love.graphics.push": {
    signature: "love.graphics.push(stacktype)",
    doc: "Pushes transform/state stack.",
    params: [{ name: "stacktype", typeName: "string", description: "all or transform" }],
  },
  "love.graphics.pop": {
    signature: "love.graphics.pop()",
    doc: "Pops transform/state stack.",
    params: [],
  },
  "love.graphics.translate": {
    signature: "love.graphics.translate(x, y)",
    doc: "Applies translation transform.",
    params: [
      { name: "x", typeName: "number", description: "X offset" },
      { name: "y", typeName: "number", description: "Y offset" },
    ],
  },
  "love.graphics.rotate": {
    signature: "love.graphics.rotate(angle)",
    doc: "Applies rotation transform.",
    params: [{ name: "angle", typeName: "number", description: "Rotation in radians" }],
  },
  "love.graphics.scale": {
    signature: "love.graphics.scale(sx, sy)",
    doc: "Applies scale transform.",
    params: [
      { name: "sx", typeName: "number", description: "X scale" },
      { name: "sy", typeName: "number", description: "Y scale" },
    ],
  },
  "love.graphics.rectangle": {
    signature: "love.graphics.rectangle(mode, x, y, w, h, rx, ry, segments)",
    doc: "Draws a rectangle shape.",
    params: [
      { name: "mode", typeName: "string", description: "fill or line" },
      { name: "x", typeName: "number", description: "X position" },
      { name: "y", typeName: "number", description: "Y position" },
      { name: "w", typeName: "number", description: "Width" },
      { name: "h", typeName: "number", description: "Height" },
      { name: "rx", typeName: "number", description: "Corner radius X" },
      { name: "ry", typeName: "number", description: "Corner radius Y" },
      { name: "segments", typeName: "number", description: "Corner segment count" },
    ],
  },

  "love.window.setMode": {
    signature: "love.window.setMode(width, height, flags)",
    doc: "Sets the window dimensions and optional display flags.",
    params: [
      { name: "width", typeName: "number", description: "Window width" },
      { name: "height", typeName: "number", description: "Window height" },
      { name: "flags", typeName: "table", description: "Mode flags (fullscreen, resizable, vsync, etc.)" },
    ],
  },
  "love.window.setTitle": {
    signature: "love.window.setTitle(title)",
    doc: "Sets the window title.",
    params: [{ name: "title", typeName: "string", description: "Title text" }],
  },
  "love.window.getMode": {
    signature: "love.window.getMode()",
    doc: "Returns width, height, and flags table.",
    params: [],
  },

  "love.audio.play": {
    signature: "love.audio.play(source)",
    doc: "Plays one or more Source objects.",
    params: [
      { name: "source", typeName: "Source|table", description: "Audio source(s)" },
    ],
  },
  "love.audio.newSource": {
    signature: "love.audio.newSource(filename, type)",
    doc: "Creates a new Source from file or SoundData.",
    params: [
      { name: "filename", typeName: "string|SoundData", description: "Audio input" },
      { name: "type", typeName: "string", description: "static or stream" },
    ],
  },
  "love.audio.setVolume": {
    signature: "love.audio.setVolume(volume)",
    doc: "Sets global master volume.",
    params: [{ name: "volume", typeName: "number", description: "0..1" }],
  },
  "love.audio.stop": {
    signature: "love.audio.stop(source)",
    doc: "Stops playback for source(s) or all when omitted.",
    params: [{ name: "source", typeName: "Source|table", description: "Source(s) to stop" }],
  },

  "love.filesystem.read": {
    signature: "love.filesystem.read(filename)",
    doc: "Reads all bytes from a file and returns its content.",
    params: [
      { name: "filename", typeName: "string", description: "File path" },
    ],
  },
  "love.filesystem.write": {
    signature: "love.filesystem.write(filename, data, size)",
    doc: "Writes data to file in save directory.",
    params: [
      { name: "filename", typeName: "string", description: "Output file" },
      { name: "data", typeName: "string|Data", description: "Data to write" },
      { name: "size", typeName: "number", description: "Optional byte count" },
    ],
  },
  "love.filesystem.getInfo": {
    signature: "love.filesystem.getInfo(path, filtertype)",
    doc: "Returns file info table or nil.",
    params: [
      { name: "path", typeName: "string", description: "File or directory path" },
      { name: "filtertype", typeName: "string", description: "file, directory, symlink" },
    ],
  },
  "love.filesystem.getDirectoryItems": {
    signature: "love.filesystem.getDirectoryItems(dir)",
    doc: "Returns a list of files/directories within a directory.",
    params: [{ name: "dir", typeName: "string", description: "Directory path" }],
  },
  "love.filesystem.load": {
    signature: "love.filesystem.load(filename)",
    doc: "Loads a Lua file and returns a callable chunk.",
    params: [{ name: "filename", typeName: "string", description: "Lua file" }],
  },

  "love.timer.getDelta": {
    signature: "love.timer.getDelta()",
    doc: "Returns the time between the last two frames (in seconds).",
    params: [],
  },
  "love.timer.getTime": {
    signature: "love.timer.getTime()",
    doc: "Returns current value of high-resolution timer.",
    params: [],
  },
  "love.timer.sleep": {
    signature: "love.timer.sleep(seconds)",
    doc: "Sleeps the thread for a short period.",
    params: [{ name: "seconds", typeName: "number", description: "Sleep duration" }],
  },
  "love.timer.step": {
    signature: "love.timer.step()",
    doc: "Updates internal delta timing state.",
    params: [],
  },

  "love.math.random": {
    signature: "love.math.random([min,] max)",
    doc: "Returns a pseudo-random number.",
    params: [
      { name: "min", typeName: "number", description: "Optional minimum" },
      { name: "max", typeName: "number", description: "Maximum (or upper bound if min omitted)" },
    ],
  },
  "love.math.randomseed": {
    signature: "love.math.randomseed(seed)",
    doc: "Sets random seed for love.math.random.",
    params: [{ name: "seed", typeName: "number", description: "Seed value" }],
  },
  "love.math.noise": {
    signature: "love.math.noise(x, y, z, w)",
    doc: "Returns simplex noise value.",
    params: [
      { name: "x", typeName: "number", description: "First coordinate" },
      { name: "y", typeName: "number", description: "Second coordinate" },
      { name: "z", typeName: "number", description: "Third coordinate" },
      { name: "w", typeName: "number", description: "Fourth coordinate" },
    ],
  },

  "love.physics.newWorld": {
    signature: "love.physics.newWorld(gx, gy, sleep)",
    doc: "Creates a new Box2D world.",
    params: [
      { name: "gx", typeName: "number", description: "Gravity X" },
      { name: "gy", typeName: "number", description: "Gravity Y" },
      { name: "sleep", typeName: "boolean", description: "Allow sleeping bodies" },
    ],
  },
  "love.physics.newBody": {
    signature: "love.physics.newBody(world, x, y, type)",
    doc: "Creates a new physics body.",
    params: [
      { name: "world", typeName: "World", description: "Physics world" },
      { name: "x", typeName: "number", description: "X position" },
      { name: "y", typeName: "number", description: "Y position" },
      { name: "type", typeName: "string", description: "static, dynamic, or kinematic" },
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
    params: [{ name: "text", typeName: "string", description: "Clipboard content" }],
  },
  "love.system.getClipboardText": {
    signature: "love.system.getClipboardText()",
    doc: "Gets clipboard text.",
    params: [],
  },
  "love.system.openURL": {
    signature: "love.system.openURL(url)",
    doc: "Opens URL using system default handler.",
    params: [{ name: "url", typeName: "string", description: "Target URL" }],
  },

  "love.thread.newThread": {
    signature: "love.thread.newThread(filename)",
    doc: "Creates a thread from Lua file or source code.",
    params: [{ name: "filename", typeName: "string", description: "Thread script" }],
  },
  "love.thread.getChannel": {
    signature: "love.thread.getChannel(name)",
    doc: "Returns a named Channel object.",
    params: [{ name: "name", typeName: "string", description: "Channel name" }],
  },
};

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
        doc: LOVE_NAMESPACES[fullName] ? LOVE_NAMESPACES[fullName].doc : "LÖVE namespace",
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
