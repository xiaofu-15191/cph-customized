import { getLanguage, ocHide, ocShow, ocWrite } from './utils';
import { Language } from './types';
import { spawn } from 'child_process';
import path from 'path';
import {
    getSaveLocationPref,
    getHideStderrorWhenCompiledOK,
} from './preferences';
import * as vscode from 'vscode';
import { getJudgeViewProvider } from './extension';
import fs from 'fs';
import crypto from 'crypto';
export let onlineJudgeEnv = false;

export const setOnlineJudgeEnv = (value: boolean) => {
    onlineJudgeEnv = value;
    console.log('online judge env:', onlineJudgeEnv);
};

/**
 *  Get the location to save the generated binary in. If save location is
 *  available in preferences, returns that, otherwise returns the director of
 *  active file.
 *
 *  If it is a interpteted language, simply returns the path to the source code.
 *
 *  @param srcPath location of the source code
 */
export const getBinSaveLocation = (srcPath: string): string => {
    const language = getLanguage(srcPath);
    if (language.skipCompile) {
        return srcPath;
    }
    const ext = language.name == 'java' ? '*.class' : '.bin';
    const savePreference = getSaveLocationPref();
    const srcFileName = path.parse(srcPath).name;
    const srcFolder = path.dirname(srcPath);
    const binFileName = srcFileName + ext;
    const cphFolder = path.join(srcFolder, '.cph');
    if (savePreference && savePreference !== '') {
        return path.join(savePreference, binFileName);
    }
    return path.join(cphFolder, binFileName);
};

/**
 * Get the complete list of required arguments to be passed to the compiler.
 * Loads additional args from preferences if available.
 *
 * @param language The Language object for the source code
 * @param srcPath location of the source code
 */
const getFlags = (language: Language, srcPath: string): string[] => {
    // The language.args are fetched from user saved preferences, if any.
    let args = language.args;
    if (args[0] === '') args = [];
    let ret: string[];
    switch (language.name) {
        case 'cpp': {
            ret = [
                srcPath,
                '-o',
                getBinSaveLocation(srcPath),
                ...args,
                '-D',
                'DEBUG',
                '-D',
                'CPH',
            ];
            if (onlineJudgeEnv) {
                ret.push('-D');
                ret.push('ONLINE_JUDGE');
            }
            break;
        }
        case 'c': {
            {
                ret = [srcPath, '-o', getBinSaveLocation(srcPath), ...args];
                if (onlineJudgeEnv) {
                    ret.push('-D');
                    ret.push('ONLINE_JUDGE');
                }
                break;
            }
        }
        case 'rust': {
            ret = [srcPath, '-o', getBinSaveLocation(srcPath), ...args];
            break;
        }
        case 'go': {
            ret = [
                'build',
                '-o',
                getBinSaveLocation(srcPath),
                srcPath,
                ...args,
            ];
            break;
        }
        case 'java': {
            const binDir = path.dirname(getBinSaveLocation(srcPath));
            ret = [srcPath, '-d', binDir, ...args];
            break;
        }
        case 'hs': {
            ret = [
                srcPath,
                '-o',
                getBinSaveLocation(srcPath),
                '-no-keep-hi-files',
                '-no-keep-o-files',
                ...args,
            ];
            break;
        }
        default: {
            ret = [];
            break;
        }
    }
    return ret;
};

/**
 * Compile a source file, storing the output binary in a location based on user
 * preferences. If `skipCompile` is true for a language, skips the compilation
 * and resolves true. If there is no preference, stores in the current
 * directory. Resolves true if it succeeds, false otherwise.
 *
 * Saves the file before compilation starts.
 *
 * @param srcPath location of the source code
 */

export const getHashSaveLocation = (srcPath: string): string => {
    const savePreference = getSaveLocationPref();
    const srcFileName = path.basename(srcPath);
    const srcFolder = path.dirname(srcPath);
    const baseHashName = `.${srcFileName}.hash`;
    const cphFolder = path.join(srcFolder, '.cph');
    if (savePreference && savePreference !== '') {
        return path.join(savePreference, baseHashName);
    }
    return path.join(cphFolder, baseHashName);
};

export const getFileHashVal = (srcPath: string): string => {
    const srcContent = fs.readFileSync(srcPath).toString();
    return crypto.createHash('sha256').update(srcContent).digest('hex');
};

export const checkNotModified = (srcPath: string): boolean => {
    console.log(
        'Checking if <' + srcPath + "> isn't modified since last compile.",
    );
    const hashPath = getHashSaveLocation(srcPath);
    try {
        const past: string = fs.readFileSync(hashPath).toString();
        const current: string = getFileHashVal(srcPath);
        if (past != current) {
            return false;
        }
        fs.accessSync(getBinSaveLocation(srcPath));
        return true;
    } catch (err) {
        return false;
    }
};

export const updateFileHash = (srcPath: string): boolean => {
    console.log('Updating <' + srcPath + ">'s Hashval.");
    try {
        const hashPath = getHashSaveLocation(srcPath);
        const currentHashval = getFileHashVal(srcPath);
        fs.writeFileSync(hashPath, currentHashval);
        return true;
    } catch (err) {
        console.error('Failed Updating <' + srcPath + ">'s Hashval.");
        return false;
    }
};

export const compileFile = async (srcPath: string): Promise<boolean> => {
    console.log('Compilation Started');
    await vscode.workspace.openTextDocument(srcPath).then((doc) => doc.save());
    ocHide();
    const language: Language = getLanguage(srcPath);
    if (language.skipCompile || checkNotModified(srcPath)) {
        return Promise.resolve(true);
    }
    try {
        fs.unlinkSync(getBinSaveLocation(srcPath));
    } catch (err) {
        console.warn('Error when deleting the .bin file.');
    }
    getJudgeViewProvider().extensionToJudgeViewMessage({
        command: 'compiling-start',
    });
    const flags: string[] = getFlags(language, srcPath);
    console.log('Compiling with flags', flags);
    const result = new Promise<boolean>((resolve) => {
        let compiler;
        try {
            compiler = spawn(language.compiler, flags);
        } catch (err) {
            vscode.window.showErrorMessage(
                `Could not launch the compiler ${language.compiler}. Is it installed?`,
            );
            throw err;
        }
        let error = '';

        compiler.stderr.on('data', (data) => {
            error += data;
        });

        compiler.on('error', (err) => {
            console.error(err);
            ocWrite(
                'Errors while compiling:\n' +
                    err.message +
                    `\n\nHint: Is the compiler ${language.compiler} installed? Check the compiler command in cph settings for the current language.`,
            );
            getJudgeViewProvider().extensionToJudgeViewMessage({
                command: 'compiling-stop',
            });
            getJudgeViewProvider().extensionToJudgeViewMessage({
                command: 'not-running',
            });
            ocShow();
            resolve(false);
        });

        compiler.on('exit', (exitcode) => {
            const exitCode = exitcode || 0;
            const hideWarningsWhenCompiledOK = getHideStderrorWhenCompiledOK();

            if (exitCode !== 0) {
                ocWrite(
                    `Exit code: ${exitCode} Errors while compiling:\n` + error,
                );
                ocShow();
                console.error('Compilation failed');
                getJudgeViewProvider().extensionToJudgeViewMessage({
                    command: 'compiling-stop',
                });
                getJudgeViewProvider().extensionToJudgeViewMessage({
                    command: 'not-running',
                });
                resolve(false);
                return;
            }

            if (!hideWarningsWhenCompiledOK && error.trim() !== '') {
                ocWrite(
                    `Exit code: ${exitCode} Warnings while compiling:\n ` +
                        error,
                );
                ocShow();
            }

            console.log('Compilation passed');
            getJudgeViewProvider().extensionToJudgeViewMessage({
                command: 'compiling-stop',
            });
            resolve(true);
            return;
        });
    });
    updateFileHash(srcPath);
    return result;
};
