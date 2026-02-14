export class AsyncQueue {
  private concurrency: number;
  private running = 0;
  private queue: Array<{
    task: () => Promise<void>;
    resolve: () => void;
    reject: (err: unknown) => void;
  }> = [];

  constructor(concurrency = 3) {
    this.concurrency = concurrency;
  }

  add(task: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.run();
    });
  }

  private run(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.running++;
      item
        .task()
        .then(() => item.resolve())
        .catch((err) => item.reject(err))
        .finally(() => {
          this.running--;
          this.run();
        });
    }
  }

  async drain(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return;
    return new Promise<void>((resolve) => {
      const check = (): void => {
        if (this.running === 0 && this.queue.length === 0) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }
}
