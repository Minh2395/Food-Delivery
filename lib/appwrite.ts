import { CreateUserParams, SignInParams, User } from "@/type";
import { Account, Client, Databases, ID, Query } from "react-native-appwrite";

export const appwriteConfig = {
  endpoint: process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT!,
  platform: "com.fooddelivery",
  projectId: process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID!,
  databaseId: process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID!,
  userCollectionId: "user",
};

export const client = new Client();

client
  .setEndpoint(appwriteConfig.endpoint)
  .setProject(appwriteConfig.projectId)
  .setPlatform(appwriteConfig.platform);

export const account = new Account(client);
export const databases = new Databases(client);

const buildInitialsAvatarUrl = (name: string) => {
  const cleanedEndpoint = appwriteConfig.endpoint.replace(/\/+$/, "");
  const encodedName = encodeURIComponent(name.trim());
  return `${cleanedEndpoint}/avatars/initials?name=${encodedName}&width=256&height=256`;
};

const ensureString = (value: unknown, label: string) => {
  if (typeof value !== "string") {
    throw new Error(`Expected ${label} to be a string but got ${typeof value}`);
  }

  return value;
};

export const createUser = async ({
  email,
  password,
  name,
}: CreateUserParams) => {
  console.log("[Appwrite] createUser start", {
    email,
    name,
    databaseId: appwriteConfig.databaseId,
    collectionId: appwriteConfig.userCollectionId,
  });

  if (!email || !password || !name) {
    throw new Error(
      "Missing required user fields: email, password, and name are all required.",
    );
  }

  try {
    const newAccount = await account.create(ID.unique(), email, password, name);
    console.log("[Appwrite] account.create success", {
      userId: newAccount.$id,
    });

    const session = await account.createEmailPasswordSession(email, password);
    console.log("[Appwrite] createEmailPasswordSession success", {
      sessionId: session.$id ?? null,
    });

    const avatarUrl = buildInitialsAvatarUrl(name);
    console.log("[Appwrite] built avatarUrl", avatarUrl);

    const payload = {
      email,
      name,
      accountId: newAccount.$id,
      avatar: ensureString(avatarUrl, "avatar"),
    };

    const newDocument = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.userCollectionId,
      ID.unique(),
      payload,
    );

    console.log("[Appwrite] databases.createDocument success", newDocument);
    return newDocument;
  } catch (error) {
    console.error("[Appwrite] createUser failed", error);
    if (error instanceof Error) {
      throw new Error(`[Appwrite createUser] ${error.message}`);
    }
    throw error;
  }
};

export const signIn = async ({ email, password }: SignInParams) => {
  try {
    const session = await account.createEmailPasswordSession(email, password);
    console.log("[Appwrite] signIn success", {
      sessionId: session.$id ?? null,
    });
    return session;
  } catch (error) {
    console.error("[Appwrite] signIn failed", error);
    if (error instanceof Error) {
      throw new Error(`[Appwrite signIn] ${error.message}`);
    }
    throw error;
  }
};

export const getCurrentUser = async (): Promise<User | null> => {
  try {
    const currentAccount = await account.get();
    if (!currentAccount) throw Error;

    const currentUser = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.userCollectionId,
      [Query.equal("accountId", currentAccount.$id)],
    );

    if (currentUser.documents.length === 0) return null;

    return currentUser.documents[0] as unknown as User;
  } catch (e) {
    console.log(e);
    throw new Error(e as string);
  }
};
