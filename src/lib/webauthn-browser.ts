export function base64UrlToUint8Array(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(base64 + padding), (char) => char.charCodeAt(0));
}

export function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const bytes = base64UrlToUint8Array(value);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function arrayBufferToBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

type RegistrationCredentialSource = {
  id: string;
  response: {
    clientDataJSON: ArrayBuffer;
    attestationObject: ArrayBuffer;
    getTransports?: () => string[] | readonly string[];
  };
};

export function serializeRegistrationCredential(credential: RegistrationCredentialSource) {
  const transports = credential.response.getTransports?.();

  return {
    id: credential.id,
    response: {
      clientDataJSON: arrayBufferToBase64Url(credential.response.clientDataJSON),
      attestationObject: arrayBufferToBase64Url(credential.response.attestationObject),
      ...(transports && transports.length > 0 ? { transports: Array.from(transports) } : {}),
    },
  };
}
