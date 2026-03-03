import { JwtPayload } from "jsonwebtoken";

export type UserRole = "admin";

export interface JwtUserPayload extends JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  store_id: string;
  full_access?: boolean;
}
