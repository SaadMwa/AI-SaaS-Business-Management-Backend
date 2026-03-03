import jwt from "jsonwebtoken";
import { User } from "../models/user";
import { env } from "../config/env";
import { UserRole } from "../types/auth";

interface AuthResult {
  token: string;
  user: { id: string; name: string; email: string; role: UserRole; store_id: string; full_access: true };
}

interface AuthServiceResult {
  data?: AuthResult;
  error?: { message: string; status: number };
}

export const loginUser = async (email: string, password: string): Promise<AuthServiceResult> => {
  const user = await User.findOne({ email });
  if (!user) {
    return { error: { message: "Invalid email or password", status: 400 } };
  }
  if (user.role !== "admin") {
    return { error: { message: "Only admin users can sign in.", status: 403 } };
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return { error: { message: "Invalid email or password", status: 400 } };
  }

  if (!env.jwtSecret) {
    return { error: { message: "JWT secret is not configured.", status: 500 } };
  }

  const token = jwt.sign(
    {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      store_id: user.storeId,
      full_access: true,
    },
    env.jwtSecret,
    { expiresIn: "1d" }
  );

  return {
    data: {
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        store_id: user.storeId,
        full_access: true,
      },
    },
  };
};
