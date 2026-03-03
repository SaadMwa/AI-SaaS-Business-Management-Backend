import { User } from "../models/user";

export const getProfileData = async (userId?: string) => {
  if (!userId) return null;
  const user = await User.findById(userId).select("_id name email role storeId").lean();
  if (!user) return null;
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    store_id: user.storeId,
    full_access: true,
  };
};

export const deleteUserById = (id: string) => {
  return { message: `User deleted (admin only)`, id };
};

export const getDashboardMessage = () => {
  return { message: "Welcome to dashboard" };
};

export const getProtectedData = () => {
  return { data: "Some sensitive info" };
};

export const getAssignableUsers = async () => {
  const users = await User.find({}, "_id name email").sort({ name: 1 });
  return users;
};
