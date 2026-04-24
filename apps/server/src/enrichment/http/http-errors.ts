export class NotFoundError extends Error {
  constructor(public readonly url: string) {
    super(`Upstream 404: ${url}`);
    this.name = 'NotFoundError';
  }
}

export class UpstreamServerError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number
  ) {
    super(`Upstream ${status}: ${url}`);
    this.name = 'UpstreamServerError';
  }
}

export class UpstreamParseError extends Error {
  constructor(public readonly url: string) {
    super(`Upstream non-JSON response: ${url}`);
    this.name = 'UpstreamParseError';
  }
}
