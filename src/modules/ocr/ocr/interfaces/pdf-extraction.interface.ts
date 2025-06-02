import { ImportArticleDto } from "../dtos/import-article.dto";

export interface IPdfExtractionResult {
  success: boolean;
  fileName: string;
  totalPages: number;
  pages: Array<{
    id: number;
    name: string;
    contentLength: number;
    preview: string;
    extractedData?: ImportArticleDto;
  }>;
  metadata: {
    extractionDate: Date;
    source: string;
  };
}