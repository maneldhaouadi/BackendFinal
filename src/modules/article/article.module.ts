// src/modules/article/article.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { OcrModule } from '../ocr/ocr.module';
import { ArticleRepositoryModule } from './repositories/article.repository.module';
import { ArticleHistoryModule } from '../article-history/article-history.module';
import { ArticleService } from './services/article.service';
import { PdfService } from '../../common/pdf/services/pdf.service';
import { PdfModule } from '../pdf-extraction/pdf.module';
import { TextSimilarityService } from './services/TextSimilarityService';
import { ArticleOcrService } from '../ocr/services/articleOcrService';

@Module({
  imports: [
    ArticleRepositoryModule,
    forwardRef(() => ArticleHistoryModule),
    forwardRef(() => OcrModule),
    PdfModule, // Utiliser le bon nom de module
  ],
  providers: [
    ArticleService,
    PdfService,
    TextSimilarityService,
    {
      provide: 'ARTICLE_OCR_SERVICE',
      useClass: ArticleOcrService,
    },
  ],
  exports: [
    ArticleService,
    PdfService,
    TextSimilarityService,
    'ARTICLE_OCR_SERVICE',
  ],
})
export class ArticleModule {}