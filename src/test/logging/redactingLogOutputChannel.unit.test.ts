import { expect } from 'chai';
import * as os from 'os';

import { redactLogMessage } from '../../client/logging/redactingLogOutputChannel';

suite('Python logging redaction', () => {
    test('redacts credentials and home paths at the output boundary', () => {
        expect(redactLogMessage(`Bearer abc bearer_token=xyz --access-token=secret ${os.homedir()}/project`)).to.equal(
            'Bearer <redacted> bearer_token=<redacted> --access-token=<redacted> <home>/project',
        );
    });
});
