import { ID, Query } from "react-native-appwrite";
import { appwriteConfig, databases, storage } from "./appwrite";
import dummyData from "./data";

interface Category {
  name: string;
  description: string;
}

interface Customization {
  name: string;
  price: number;
  type: "topping" | "side" | "size" | "crust" | string;
}

interface MenuItem {
  name: string;
  description: string;
  image_url: string;
  price: number;
  rating: number;
  calories: number;
  protein: number;
  category_name: string;
  customizations: string[];
}

interface DummyData {
  categories: Category[];
  customizations: Customization[];
  menu: MenuItem[];
}

const data = dummyData as DummyData;
const PAGE_SIZE = 100;
const DELETE_BATCH_SIZE = 10;
let activeSeedPromise: Promise<void> | null = null;

const log = (...items: unknown[]) => console.log("[seed]", ...items);
const warn = (...items: unknown[]) => console.warn("[seed]", ...items);
const fatal = (...items: unknown[]) => console.error("[seed]", ...items);

const slugifyId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 30) || ID.unique();

const buildStableId = (prefix: string, value: string) => {
  const id = `${prefix}-${slugifyId(value)}`.slice(0, 36);
  return id || ID.unique();
};

const chunkArray = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

async function listAllDocuments(collectionId: string) {
  const documents: { $id: string }[] = [];
  let offset = 0;

  while (true) {
    const response = await databases.listDocuments({
      databaseId: appwriteConfig.databaseId,
      collectionId,
      queries: [Query.limit(PAGE_SIZE), Query.offset(offset)],
      total: true,
    });

    documents.push(...response.documents);
    log(
      `Fetched ${response.documents.length} documents from ${collectionId} (offset ${offset})`,
    );

    if (response.documents.length < PAGE_SIZE) {
      break;
    }

    offset += response.documents.length;
  }

  return documents;
}

async function clearAll(collectionId: string) {
  log(`Clearing collection ${collectionId}`);

  const documents = await listAllDocuments(collectionId);
  if (documents.length === 0) {
    log(`No documents found for ${collectionId}`);
    return;
  }

  const chunks = chunkArray(documents, DELETE_BATCH_SIZE);
  for (const [index, chunk] of chunks.entries()) {
    log(`Deleting batch ${index + 1}/${chunks.length} from ${collectionId}`);
    const results = await Promise.allSettled(
      chunk.map((doc) =>
        databases.deleteDocument({
          databaseId: appwriteConfig.databaseId,
          collectionId,
          documentId: doc.$id,
        }),
      ),
    );

    const errors = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason);

    if (errors.length > 0) {
      fatal(
        `Failed to delete ${errors.length} documents from ${collectionId}`,
        errors,
      );
      throw new Error(`Failed to clear collection ${collectionId}`);
    }
  }

  log(`Cleared ${documents.length} documents from ${collectionId}`);
}

async function listAllFiles() {
  const files: { $id: string }[] = [];
  let offset = 0;

  while (true) {
    const response = await storage.listFiles({
      bucketId: appwriteConfig.bucketId,
      queries: [Query.limit(PAGE_SIZE), Query.offset(offset)],
      total: true,
    });

    files.push(...response.files);
    log(
      `Fetched ${response.files.length} files from bucket (offset ${offset})`,
    );

    if (response.files.length < PAGE_SIZE) {
      break;
    }

    offset += response.files.length;
  }

  return files;
}

async function clearStorage() {
  log(`Clearing storage bucket ${appwriteConfig.bucketId}`);

  const files = await listAllFiles();
  if (files.length === 0) {
    log("No files found in storage bucket");
    return;
  }

  const chunks = chunkArray(files, DELETE_BATCH_SIZE);
  for (const [index, chunk] of chunks.entries()) {
    log(`Deleting file batch ${index + 1}/${chunks.length}`);
    const results = await Promise.allSettled(
      chunk.map((file) =>
        storage.deleteFile({
          bucketId: appwriteConfig.bucketId,
          fileId: file.$id,
        }),
      ),
    );

    const errors = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason);

    if (errors.length > 0) {
      fatal("Failed to delete files from storage bucket", errors);
      throw new Error("Failed to clear storage bucket");
    }
  }

  log(`Cleared ${files.length} files from storage bucket`);
}

async function uploadImageToStorage(imageUrl: string, fallbackId: string) {
  const filename = imageUrl.split("/").pop() || `image-${Date.now()}.jpg`;
  const fileId = buildStableId("image", fallbackId);

  log(`Uploading image for ${fallbackId}: ${imageUrl}`);

  let contentType = "image/jpeg";
  let size = 0;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Image download failed with status ${response.status}`);
    }

    const blob = await response.blob();
    contentType = blob.type || contentType;
    size = blob.size;
  } catch (uploadError) {
    warn(
      `Image download failed for ${imageUrl}. Falling back to original URL.`,
      uploadError,
    );
    return imageUrl;
  }

  const fileObj = {
    name: filename,
    type: contentType,
    size,
    uri: imageUrl,
  };

  try {
    const file = await storage.createFile(
      appwriteConfig.bucketId,
      fileId,
      fileObj,
    );

    const fileUrl = storage.getFileViewURL(appwriteConfig.bucketId, file.$id);
    log(`Uploaded image ${filename} as ${file.$id}`);
    return fileUrl;
  } catch (createError) {
    warn(
      `Failed to upload image ${imageUrl}. Using the remote URL instead.`,
      createError,
    );
    return imageUrl;
  }
}

async function upsertDocument(
  collectionId: string,
  documentId: string,
  data: Record<string, any>,
) {
  return databases.upsertDocument({
    databaseId: appwriteConfig.databaseId,
    collectionId,
    documentId,
    data,
  });
}

async function doSeed(): Promise<void> {
  log("Starting seed process");

  await clearAll(appwriteConfig.categoriesCollectionId);
  await clearAll(appwriteConfig.customizationsCollectionId);
  await clearAll(appwriteConfig.menuCollectionId);
  await clearAll(appwriteConfig.menuCustomizationsCollectionId);
  await clearStorage();

  const categoryMap: Record<string, string> = {};
  for (const category of data.categories) {
    const documentId = buildStableId("category", category.name);
    const doc = await upsertDocument(
      appwriteConfig.categoriesCollectionId,
      documentId,
      category,
    );
    categoryMap[category.name] = doc.$id;
    log(`Category created: ${category.name} -> ${doc.$id}`);
  }

  const customizationMap: Record<string, string> = {};
  for (const customization of data.customizations) {
    const documentId = buildStableId("customization", customization.name);
    const doc = await upsertDocument(
      appwriteConfig.customizationsCollectionId,
      documentId,
      {
        name: customization.name,
        price: customization.price,
        type: customization.type,
      },
    );
    customizationMap[customization.name] = doc.$id;
    log(`Customization created: ${customization.name} -> ${doc.$id}`);
  }

  for (const menuItem of data.menu) {
    log(`Creating menu item ${menuItem.name}`);
    const imageUrl = await uploadImageToStorage(
      menuItem.image_url,
      menuItem.name,
    );
    const documentId = buildStableId("menu", menuItem.name);

    const menuDoc = await upsertDocument(
      appwriteConfig.menuCollectionId,
      documentId,
      {
        name: menuItem.name,
        description: menuItem.description,
        image_url: imageUrl,
        price: menuItem.price,
        rating: menuItem.rating,
        calories: menuItem.calories,
        protein: menuItem.protein,
        categories: categoryMap[menuItem.category_name],
      },
    );

    log(`Menu item created: ${menuItem.name} -> ${menuDoc.$id}`);

    for (const customizationName of menuItem.customizations) {
      const customizationId = customizationMap[customizationName];
      if (!customizationId) {
        warn(
          `Skipping missing customization ${customizationName} for menu ${menuItem.name}`,
        );
        continue;
      }

      const relationshipId = buildStableId(
        "menu-customization",
        `${menuItem.name}-${customizationName}`,
      );

      await upsertDocument(
        appwriteConfig.menuCustomizationsCollectionId,
        relationshipId,
        {
          menu: menuDoc.$id,
          customizations: customizationId,
        },
      );
      log(`Linked ${menuItem.name} -> ${customizationName}`);
    }
  }

  log("✅ Seeding complete.");
}

async function seed(): Promise<void> {
  if (activeSeedPromise) {
    warn("Seed already in progress, returning existing promise.");
    return activeSeedPromise;
  }

  activeSeedPromise = doSeed()
    .catch((error) => {
      fatal("Seed failed", error);
      throw error;
    })
    .finally(() => {
      activeSeedPromise = null;
    });

  return activeSeedPromise;
}

export default seed;
