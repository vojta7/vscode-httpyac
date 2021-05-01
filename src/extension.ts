import * as vscode from 'vscode';
import * as provider from './provider';
import * as httpyac from 'httpyac';
import { responseHandlers, ResponseOutputProcessor } from './view/responseOutputProcessor';
import * as config from './config';
import { initVscodeLogger } from './logger';
import { promises as fs } from 'fs';
import { isAbsolute, join } from 'path';


export interface HttpYacExtensionApi{
  httpyac: typeof httpyac,
  responseHandlers: typeof responseHandlers,
  httpFileStore: httpyac.HttpFileStore,
  config: typeof config,
  refreshCodeLens: vscode.EventEmitter<void>,
  environementChanged: vscode.EventEmitter<string[] | undefined>
}


export function activate(context: vscode.ExtensionContext) : HttpYacExtensionApi {
  httpyac.httpYacApi.additionalRequire.vscode = vscode;
  httpyac.httpYacApi.httpRegionParsers.push(new httpyac.parser.NoteMetaHttpRegionParser(async (note: string) => {
    const buttonTitle = 'Execute';
    const result = await vscode.window.showWarningMessage(note, { modal: true }, buttonTitle);
    return result === buttonTitle;
  }));

  httpyac.httpYacApi.variableReplacers.splice(0, 0, new httpyac.variables.replacer.ShowInputBoxVariableReplacer(
    async (message: string, defaultValue: string) => await vscode.window.showInputBox({
      placeHolder: message,
      value: defaultValue,
      prompt: message
    })
  ));
  httpyac.httpYacApi.variableReplacers.splice(0, 0, new httpyac.variables.replacer.ShowQuickpickVariableReplacer(
    async (message: string, values: string[]) => await vscode.window.showQuickPick(values, {
      placeHolder: message
    })
  ));

  const responseOutputProcessor = new ResponseOutputProcessor();

  const refreshCodeLens = new vscode.EventEmitter<void>();

  const environementChanged = new vscode.EventEmitter<string[] | undefined>();

  const httpFileStore = new httpyac.HttpFileStore();
  context.subscriptions.push(...[
    refreshCodeLens,
    new provider.HttpFileStoreController(httpFileStore, refreshCodeLens),
    new provider.HarCommandsController(httpFileStore),
    new provider.RequestCommandsController(refreshCodeLens, responseOutputProcessor, httpFileStore),
    new provider.EnvironmentController(environementChanged, refreshCodeLens, httpFileStore),
    new provider.DecorationProvider(context, refreshCodeLens, httpFileStore),
    new provider.HttpCompletionItemProvider(httpFileStore),
    responseOutputProcessor,
    vscode.languages.registerDocumentSymbolProvider(config.httpDocumentSelector, new provider.HttpDocumentSymbolProvider(httpFileStore)),
    config.watchConfigSettings(configuration => {
      httpFileStore.clear();
      const index = httpyac.httpYacApi.httpRegionParsers.findIndex(obj => obj instanceof httpyac.parser.SettingsScriptHttpRegionParser);
      if (index >= 0) {
        httpyac.httpYacApi.httpRegionParsers.splice(index, 1);
      }
      if (configuration.httpRegionScript) {
        httpyac.httpYacApi.httpRegionParsers.push(new httpyac.parser.SettingsScriptHttpRegionParser(async () => {
          const fileName = config.getConfigSetting().httpRegionScript;
          if (fileName) {
            if (isAbsolute(fileName)) {
              try {
                const script = await fs.readFile(fileName, 'utf-8');
                return { script, lineOffset: 0 };
              } catch (err) {
                httpyac.log.trace(`file not found: ${fileName}`);
              }
            } else if (vscode.workspace.workspaceFolders) {
              for (const workspaceFolder of vscode.workspace.workspaceFolders) {
                const file = join(workspaceFolder.uri.fsPath, fileName);
                try {
                  const script = await fs.readFile(file, 'utf-8');
                  return {
                    script,
                    lineOffset: 0
                  };
                } catch (err) {
                  httpyac.log.trace(`file not found: ${file}`);
                }
              }
            }
          }
          return undefined;
        }));
      }
    }),
    initExtensionScript(),
    initVscodeLogger(),
  ]);

  return {
    httpyac,
    httpFileStore,
    responseHandlers,
    config,
    refreshCodeLens,
    environementChanged
  };
}


function initExtensionScript() {
  const disposable = config.watchConfigSettings(async config => {
    try {
      const extensionScript = config.extensionScript;
      if (extensionScript) {
        if (isAbsolute(extensionScript) && await fs.stat(extensionScript)) {
          const script = await fs.readFile(extensionScript, { encoding: 'utf-8' });
          await httpyac.actions.executeScript({
            script,
            fileName: extensionScript,
            variables: {},
            lineOffset: 0
          });
          httpyac.log.info('extenionscript executed. dispose config watcher');
          if (disposable) {
            disposable.dispose();
          }
        } else {
          httpyac.popupService.error('extenionscript not found');
          httpyac.log.error('extenionscript not found');
        }
      }
    } catch (err) {
      httpyac.log.error(err);
    }
  });
  return disposable;
}
