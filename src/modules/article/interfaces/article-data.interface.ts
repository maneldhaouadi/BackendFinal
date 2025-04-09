// src/shared/interfaces/article-data.interface.ts
export interface ArticleData {
    title: string;
    description: string;
    category: string;
    subCategory: string; // Rendue obligatoire
    purchasePrice: number;
    salePrice: number;
    quantityInStock: number;
    barcode?: string;
    status?: string;
    version?: number;
    date?: Date;
    rawText?: string;
}