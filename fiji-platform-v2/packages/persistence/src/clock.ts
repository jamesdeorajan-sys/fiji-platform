export interface Clock {
  now(): string;
}
export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}
export class FakeClock implements Clock {
  private instant: string;
  constructor(instant: string) {
    this.instant = instant;
  }
  now(): string {
    return this.instant;
  }
  set(instant: string): void {
    this.instant = instant;
  }
}
