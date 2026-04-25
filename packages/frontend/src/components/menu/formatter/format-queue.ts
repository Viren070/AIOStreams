export class FormatQueue {
  private queue: (() => Promise<void>)[] = [];
  private processing = false;
  private readonly delay: number;

  constructor(delay: number) {
    this.delay = delay;
  }

  enqueue(formatFn: () => Promise<void>) {
    this.queue = [formatFn];
    this.process();
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const formatFn = this.queue.shift();
      if (formatFn) {
        try {
          await formatFn();
        } catch (error) {
          console.error('Error in format queue:', error);
        }
        await new Promise((resolve) => setTimeout(resolve, this.delay));
      }
    }
    this.processing = false;
  }
}
