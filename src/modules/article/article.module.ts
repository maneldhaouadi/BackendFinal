import { Module, forwardRef } from '@nestjs/common';
import { OcrModule } from '../ocr/ocr.module';
import { ArticleRepositoryModule } from './repositories/article.repository.module';
import { ArticleHistoryModule } from '../article-history/article-history.module';
import { ArticleService } from './services/article.service';
import { PdfService } from 'src/common/pdf/services/pdf.service';
import { TextSimilarityService } from './services/TextSimilarityService';
import { ArticleOcrService } from '../ocr/services/articleOcrService'; // Import de ArticleOcrService

@Module({
  imports: [
    ArticleRepositoryModule,
    ArticleHistoryModule,
    forwardRef(() => OcrModule), // 🔁 ici le forwardRef
  ],
  providers: [ArticleService, PdfService, TextSimilarityService, ArticleOcrService],
  exports: [ArticleService, PdfService, TextSimilarityService, ArticleOcrService], // Export de ArticleOcrService
})
export class ArticleModule {}
