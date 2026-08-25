import * as vscode from 'vscode';

const APK_DEBUG_TYPE = 'apk';
const DEFAULT_DEBUG_HOST = '127.0.0.1';

/**
 * Provides the descriptor for Supervisor's internal APK DAP session.
 *
 * APK starts a TCP DAP server and passes its port through `debugServer` in the
 * synthetic attach configuration created by Supervisor. Keeping this factory
 * next to the APK language integration makes the debug type usable when the
 * extension is run outside Positron as well.
 */
export function registerApkDebugAdapterFactory(): vscode.Disposable {
    return vscode.debug.registerDebugAdapterDescriptorFactory(APK_DEBUG_TYPE, {
        createDebugAdapterDescriptor(
            session: vscode.DebugSession,
        ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
            const configuration = session.configuration as vscode.DebugConfiguration | undefined;
            const debugServer = configuration?.debugServer;
            if (typeof debugServer !== 'number') {
                return undefined;
            }

            const host = typeof configuration?.host === 'string' ? configuration.host : DEFAULT_DEBUG_HOST;
            return new vscode.DebugAdapterServer(debugServer, host);
        },
    });
}
