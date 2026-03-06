import { Request, Response, NextFunction } from 'express';

// Demo validator middleware — not for production use
export const validator = (req: Request, _res: Response, next: NextFunction) => {
  // This is a placeholder demonstrating middleware shape.
  // Do not rely on this for input validation.
  // Example: attach a flag for downstream handlers to inspect.
  (req as any)._validated = true;
  next();
};

export default validator;
