import { arrayBufferToBase64Url, serializeRegistrationCredential } from '@/lib/webauthn-browser';

describe('serializeRegistrationCredential', () => {
  it('keeps only the registration fields required by register-verify', () => {
    const clientDataJSON = Uint8Array.from([1, 2, 3]).buffer;
    const attestationObject = Uint8Array.from([4, 5, 6]).buffer;

    const serialized = serializeRegistrationCredential({
      id: 'cred-1',
      response: {
        clientDataJSON,
        attestationObject,
        getTransports: () => ['internal', 'usb'],
      },
    });

    expect(serialized).toEqual({
      id: 'cred-1',
      response: {
        clientDataJSON: arrayBufferToBase64Url(clientDataJSON),
        attestationObject: arrayBufferToBase64Url(attestationObject),
        transports: ['internal', 'usb'],
      },
    });
    expect(serialized).not.toHaveProperty('rawId');
    expect(serialized).not.toHaveProperty('type');
  });
});