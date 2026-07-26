export type Id = string & { readonly __id: unique symbol };
export interface IdGenerator {
  generate(): Id;
}
export class UuidGenerator implements IdGenerator {
  generate(): Id {
    return crypto.randomUUID() as Id;
  }
}
export const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
