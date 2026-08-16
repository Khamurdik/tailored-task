import * as contract from '@dataroom/shared';
import { describe, expect, it } from 'vitest';

describe('request validation', () => {
  it('CONTRACT-005 login request rejects a malformed email before it reaches the API', () => {
    expect(
      contract.LoginRequestSchema.safeParse({ email: 'ana@corp.com', password: 'hunter2' }).success,
    ).toBe(true);

    for (const email of ['ana', 'ana@', '@corp.com', 'ana corp.com', '']) {
      const result = contract.LoginRequestSchema.safeParse({ email, password: 'hunter2' });
      expect(result.success, `"${email}" should not parse as an email`).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['email']);
    }
  });

  it('CONTRACT-006 no register schema is exported', () => {
    // There is no registration endpoint, so there is no shape for one. This is
    // a contract term, not an omission: a register schema appearing here is
    // the first step of a public signup form appearing in the product.
    const suspicious = Object.keys(contract).filter((name) =>
      /register|signup|sign_up|createuser/i.test(name),
    );
    expect(suspicious).toEqual([]);
  });

  it('CONTRACT-007 name fields reject strings over MAX_NAME_LENGTH', () => {
    const atCap = 'ä'.repeat(contract.MAX_NAME_LENGTH);
    const overCap = 'ä'.repeat(contract.MAX_NAME_LENGTH + 1);

    expect(contract.CreateFolderRequestSchema.safeParse({
      parentId: '11111111-1111-4111-8111-111111111111',
      name: atCap,
    }).success).toBe(true);

    for (const schema of [contract.CreateRoomRequestSchema, contract.RenameNodeRequestSchema]) {
      expect(schema.safeParse({ name: overCap }).success).toBe(false);
      expect(schema.safeParse({ name: '' }).success).toBe(false);
    }
  });

  it('CONTRACT-008 upload init rejects a size over MAX_FILE_SIZE', () => {
    const base = {
      parentId: '11111111-1111-4111-8111-111111111111',
      name: 'contract.pdf',
      contentType: 'application/pdf',
    };

    expect(
      contract.InitUploadRequestSchema.safeParse({ ...base, sizeBytes: contract.MAX_FILE_SIZE })
        .success,
    ).toBe(true);

    for (const sizeBytes of [contract.MAX_FILE_SIZE + 1, 0, -1, 1.5]) {
      expect(
        contract.InitUploadRequestSchema.safeParse({ ...base, sizeBytes }).success,
        `${sizeBytes} should be rejected`,
      ).toBe(false);
    }
  });
});
