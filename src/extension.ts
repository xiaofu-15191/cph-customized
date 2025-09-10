/************************************************************************************/
globalThis.storedLogs = '';
function customLogger(
    originalMethod: (...args: any[]) => void,
    ...args: any[]
) {
    originalMethod(...args);

    globalThis.storedLogs += new Date().toISOString() + ' ';
    globalThis.storedLogs +=
        args
            .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
            .join(' ') + '\n';
}

globalThis.logger = {};
globalThis.logger.log = (...args: any[]) => customLogger(console.log, ...args);
globalThis.logger.error = (...args: any[]) =>
    customLogger(console.error, ...args);
globalThis.logger.warn = (...args: any[]) =>
    customLogger(console.warn, ...args);
globalThis.logger.info = (...args: any[]) =>
    customLogger(console.info, ...args);
globalThis.logger.debug = (...args: any[]) =>
    customLogger(console.debug, ...args);
/************************************************************************************/

import * as vscode from 'vscode';
import { setupCompanionServer } from './companion';
import runTestCases from './runTestCases';
import {
    editorChanged,
    editorClosed,
    checkLaunchWebview,
} from './webview/editorChange';
import { submitToCodeForces, submitToKattis } from './submit';
import JudgeViewProvider from './webview/JudgeView';
import { getRetainWebviewContextPref } from './preferences';
import TelemetryReporter from '@vscode/extension-telemetry';
import config from './config';

let judgeViewProvider: JudgeViewProvider;

export const getJudgeViewProvider = () => {
    return judgeViewProvider;
};

const registerCommands = (context: vscode.ExtensionContext) => {
    globalThis.logger.log('Registering commands');
    const disposable = vscode.commands.registerCommand(
        'cph.runTestCases',
        () => {
            runTestCases();
        },
    );

    const disposable2 = vscode.commands.registerCommand(
        'extension.runCodeforcesTestcases',
        () => {
            runTestCases();
        },
    );

    const disposable3 = vscode.commands.registerCommand(
        'cph.submitToCodeForces',
        () => {
            submitToCodeForces();
        },
    );
    const disposable4 = vscode.commands.registerCommand(
        'cph.submitToKattis',
        () => {
            submitToKattis();
        },
    );

    judgeViewProvider = new JudgeViewProvider(context.extensionUri);

    const webviewView = vscode.window.registerWebviewViewProvider(
        JudgeViewProvider.viewType,
        judgeViewProvider,
        {
            webviewOptions: {
                retainContextWhenHidden: getRetainWebviewContextPref(),
            },
        },
    );

    context.subscriptions.push(webviewView);
    context.subscriptions.push(disposable);
    context.subscriptions.push(disposable2);
    context.subscriptions.push(disposable3);
    context.subscriptions.push(disposable4);
    globalThis.reporter = new TelemetryReporter(config.telemetryKey);
    context.subscriptions.push(globalThis.reporter);
};

// This method is called when the extension is activated
export function activate(context: vscode.ExtensionContext) {
    globalThis.logger.log('cph: activate() execution started');
    (globalThis as any).context = context;

    downloadRemoteMessage();

    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        1000,
    );
    statusBarItem.text = ' $(run-all)  Run Testcases';
    statusBarItem.tooltip =
        'Competitive Programming Helper - Run all testcases or create if none exist.';
    statusBarItem.show();
    statusBarItem.command = 'cph.runTestCases';

    registerCommands(context);
    setupCompanionServer();
    checkLaunchWebview();

    vscode.workspace.onDidCloseTextDocument((e) => {
        editorClosed(e);
    });

    vscode.window.onDidChangeActiveTextEditor((e) => {
        editorChanged(e);
    });

    vscode.window.onDidChangeVisibleTextEditors((editors) => {
        if (editors.length === 0) {
            getJudgeViewProvider().extensionToJudgeViewMessage({
                command: 'new-problem',
                problem: undefined,
            });
        }
    });

    return;
}

async function downloadRemoteMessage() {
    try {
        globalThis.logger.log('Fetching remote message');
        globalThis.remoteMessage = await (
            await fetch(config.remoteMessageUrl)
        ).text();
        getJudgeViewProvider().extensionToJudgeViewMessage({
            command: 'remote-message',
            message: globalThis.remoteMessage,
        });
        globalThis.logger.log(
            'Remote message fetched',
            globalThis.remoteMessage,
        );
    } catch (e) {
        globalThis.logger.error('Error fetching remote message', e);
    }
}
