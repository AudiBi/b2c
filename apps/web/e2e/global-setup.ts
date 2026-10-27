// @ts-expect-error module .mjs sans déclarations
import { prepare } from './prepare.mjs';

export default async function globalSetup(): Promise<void> {
  await prepare();
}
