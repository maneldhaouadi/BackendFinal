import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ArticleRepositoryModule } from './repositories/article.repository.module';
import { ArticleEntity } from './repositories/entities/article.entity';

// Services
import { ArticleService } from './services/article.service';
import { TextSimilarityService } from './services/TextSimilarityService';
import { ArticlePermissionService } from './services/article-permission.service';
import { ArticleHistoryModule } from 'src/modules/article-history/article-history/article-history.module';
import { OcrModule } from 'src/modules/ocr/ocr/ocr.module';
import { PdfModule } from 'src/common/pdf/pdf.module';
import { ArticleHistoryEntity } from 'src/modules/article-history/article-history/repositories/entities/article-history.entity';
import { PdfService } from 'src/common/pdf/services/pdf.service';
import { PdfExtractionService } from 'src/modules/pdf-extraction/services/pdf-extraction.service';
import { ArticleOcrService } from 'src/modules/ocr/ocr/services/articleOcrService';

@Module({
  imports: [
    TypeOrmModule.forFeature([ArticleEntity, ArticleHistoryEntity]),
    ArticleRepositoryModule,
    forwardRef(() => ArticleHistoryModule),
    forwardRef(() => OcrModule),
    PdfModule,
  ],
  providers: [
    ArticleService,
    PdfService,
    TextSimilarityService,
    ArticlePermissionService,
    PdfExtractionService,
    {
      provide: 'ARTICLE_OCR_SERVICE',
      useClass: ArticleOcrService,
    },
    {
      provide: DataSource,
      useFactory: () => new DataSource({
        type: 'mysql', // ou votre type de base de données
        // ... autres configurations de DataSource
      }),
    },
  ],
  exports: [
    ArticleService,
    PdfService,
    TextSimilarityService,
    ArticlePermissionService,
    PdfExtractionService,
    'ARTICLE_OCR_SERVICE',
    TypeOrmModule.forFeature([ArticleEntity, ArticleHistoryEntity]),
  ],
})
export class ArticleModule {}