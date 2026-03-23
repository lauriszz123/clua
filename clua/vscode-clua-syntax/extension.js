const path = require("path");
const { workspace } = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

let client;

function activate(context) {
  const serverModule = context.asAbsolutePath(path.join("server", "server.js"));

  const serverOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6010"] },
    },
  };

  const clientOptions = {
    documentSelector: [
      { scheme: "file", language: "clua" },
      { scheme: "untitled", language: "clua" },
      { scheme: "file", pattern: "**/*.clua" },
      { scheme: "untitled", pattern: "**/*.clua" },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.clua"),
    },
  };

  client = new LanguageClient("cluaLanguageServer", "CLua Language Server", serverOptions, clientOptions);
  context.subscriptions.push(client.start());
}

async function deactivate() {
  if (!client) {
    return;
  }
  await client.stop();
}

module.exports = {
  activate,
  deactivate,
};
