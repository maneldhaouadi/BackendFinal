import { Module } from '@nestjs/common';
import { ArticleHistoryRepositoryModule } from './repositories/article-history.repository.module';
import { ArticleHistoryService } from './services/article-history.service';
import { PdfModule } from 'src/common/pdf/pdf.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArticleEntity } from '../article/repositories/entities/article.entity';

@Module({
  imports: [
    ArticleHistoryRepositoryModule,
    PdfModule,
    TypeOrmModule.forFeature([ArticleEntity]), // Ajoutez cette ligne
  ],
  providers: [ArticleHistoryService],
  exports: [ArticleHistoryService],
})
export class ArticleHistoryModule {}