declare global {
  type DeepMocked<T> = T extends (...args: infer Args) => infer Return
    ? jest.MockedFunction<(...args: Args) => Return> & T
    : T extends object
      ? { [K in keyof T]: DeepMocked<T[K]> }
      : T;
}

export {};