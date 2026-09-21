/** Base class for errors that map to a specific HTTP status in error-handler.ts. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFound extends AppError {
  constructor(message = 'Không tìm thấy dữ liệu.') {
    super(message, 404, 'not_found');
  }
}

export class Conflict extends AppError {
  constructor(message = 'Dữ liệu đã bị thay đổi, hãy tải lại rồi thử lại.') {
    super(message, 409, 'conflict');
  }
}
