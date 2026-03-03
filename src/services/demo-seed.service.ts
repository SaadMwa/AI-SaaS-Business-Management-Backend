import { seedDemoData } from "../seed/demo.seed";

export const ensureDemoSeedData = async () => {
  await seedDemoData();
};

