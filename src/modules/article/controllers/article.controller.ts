import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiParam, ApiConsumes, ApiBody, ApiResponse } from '@nestjs/swagger';
import { PageDto } from 'src/common/database/dtos/database.page.dto';
import { ArticleService } from '../services/article.service';
import { ResponseArticleDto } from '../dtos/article.response.dto';
import { CreateArticleDto } from '../dtos/article.create.dto';
import { UpdateArticleDto } from '../dtos/article.update.dto';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { FileInterceptor } from '@nestjs/platform-express';
import * as path from 'path';
import { ArticleHistoryService } from 'src/modules/article-history/services/article-history.service';

@ApiTags('article')
@Controller({
  version: '1',
  path: '/article',
})
export class ArticleController {
  constructor(
    private readonly articleService: ArticleService,
    private readonly articleHistoryService: ArticleHistoryService,
  ) {}

  @Post('/save-with-filter-title')
  async saveWithFilterTitle(@Body() createArticleDto: CreateArticleDto): Promise<ResponseArticleDto | { message: string }> {
    const existingArticle = await this.articleService.saveWithFilterTitle(createArticleDto);

    if (existingArticle) {
      return { message: 'L\'article avec ce titre existe déjà.' };
    }

    return await this.articleService.save(createArticleDto);
  }

  @Get('/all')
  @ApiResponse({
    status: 200,
    description: 'Retourne le nombre total d\'articles',
    schema: {
      type: 'object',
      properties: {
        total: {
          type: 'number',
          example: 104,
        },
      },
    },
  })
  async findAll(@Query() options: IQueryObject): Promise<{ total: number }> {
    return await this.articleService.findAll(options);
  }

  @Get('/list')
  async findAllPaginated(@Query() query: IQueryObject): Promise<PageDto<ResponseArticleDto>> {
    return await this.articleService.findAllPaginated(query);
  }

  @Get('/:id')
  @ApiParam({ name: 'id', type: 'number', required: true })
  async findOneById(@Param('id') id: string, @Query() query: IQueryObject): Promise<ResponseArticleDto> {
    try {
      const parsedId = parseInt(id, 10);
      if (isNaN(parsedId)) {
        throw new BadRequestException('ID doit être un nombre valide.');
      }

      query.filter ? (query.filter += `,id||$eq||${parsedId}`) : (query.filter = `id||$eq||${parsedId}`);

      return await this.articleService.findOneByCondition(query);
    } catch (error) {
      console.error('Erreur dans findOneById:', error);
      throw new BadRequestException('Erreur lors de la récupération de l\'article. Détails : ' + error.message);
    }
  }

  @Post('/save')
  async save(@Body() createArticleDto: CreateArticleDto): Promise<ResponseArticleDto> {
    return await this.articleService.save(createArticleDto);
  }

  @Put('/update/:id')
  @ApiParam({ name: 'id', type: 'number', required: true })
  async update(@Param('id') id: number, @Body() updateArticleDto: UpdateArticleDto): Promise<ResponseArticleDto> {
    return await this.articleService.update(id, updateArticleDto);
  }

  @Get('/article-details/:id')
  @ApiParam({ name: 'id', type: 'number', required: true })
  async getArticleDetails(@Param('id') id: number): Promise<ResponseArticleDto> {
    try {
      if (isNaN(id)) {
        throw new BadRequestException('ID doit être un nombre valide.');
      }

      const article = await this.articleService.getArticleDetails(id);

      if (!article) {
        throw new NotFoundException('Aucun article trouvé avec cet ID.');
      }

      return article;
    } catch (error) {
      console.error('Erreur dans getArticleDetails:', error);
      throw new BadRequestException('Erreur lors de la récupération des détails de l\'article.');
    }
  }

  @Delete('/delete/:id')
  @ApiParam({ name: 'id', type: 'number', required: true })
  async delete(@Param('id') id: number): Promise<ResponseArticleDto> {
    return await this.articleService.softDelete(id);
  }/*

  @Post('import-csv')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  async importCSV(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier n\'a été envoyé');
    }

    const fileExtension = path.extname(file.originalname).toLowerCase();
    if (fileExtension !== '.csv') {
      throw new BadRequestException('Seuls les fichiers CSV sont autorisés');
    }

    try {
      const importedArticles = await this.articleService.importCSV(file);
      return {
        message: `${importedArticles.length} articles ont été importés avec succès.`,
        data: importedArticles,
      };
    } catch (error) {
      console.error('Erreur lors de l\'importation du fichier CSV:', error);
      throw new BadRequestException('Une erreur est survenue lors de l\'importation du fichier CSV');
    }
  }
*/
  @Post('import-excel')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  async importExcel(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier n\'a été envoyé.');
    }

    if (!file.mimetype.includes('excel') && !file.mimetype.includes('spreadsheet')) {
      throw new BadRequestException('Seuls les fichiers Excel sont autorisés.');
    }

    try {
      const result = await this.articleService.importExcel(file);
      return result;
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Get(':id/history')
  @ApiParam({ name: 'id', type: 'number', required: true })
  async getArticleHistory(@Param('id') id: number): Promise<any[]> {
    const historyEntries = await this.articleService.getArticleHistory(id);
    return historyEntries.map((entry) => ({
      version: entry.version,
      changes: entry.changes,
      date: entry.date,
    }));
  }

  @Get(':id/sales-performance')
  @ApiParam({ name: 'id', type: 'number' })
  async getSalesPerformance(@Param('id') id: number) {
    return this.articleService.getSalesPerformance(id);
  }
/*
  @Get('popular')
  async getPopularArticles(@Query('limit') limit: number = 10) {
    return this.articleService.getPopularArticles(limit);
  }

  @Get('stagnant')
  async getStagnantArticles(@Query('limit') limit: number = 10) {
    return this.articleService.getStagnantArticles(limit);
  }

  @Post(':id/optimize-stock')
  @ApiParam({ name: 'id', type: 'number' })
  async optimizeStock(@Param('id') id: number, @Body('newStockLevel') newStockLevel: number) {
    return this.articleService.optimizeStock(id, newStockLevel);
  }

  @Post(':id/adjust-price')
  @ApiParam({ name: 'id', type: 'number' })
  async adjustPrice(@Param('id') id: number, @Body('newPrice') newPrice: number) {
    return this.articleService.adjustPrice(id, newPrice);
  }

  @Get('stock-alerts')
  async getStockAlerts(@Query('threshold') threshold: number = 10) {
    return this.articleService.getStockAlerts(threshold);
  }

  @Get('promotion-recommendations')
  async getPromotionRecommendations() {
    return this.articleService.getPromotionRecommendations();
  }

  @Get('analyze-levels/:id')
  @ApiParam({ name: 'id', type: 'number', required: true, description: 'ID de l\'article à analyser' })
  async analyzeArticlesByLevels(@Param('id') id: string): Promise<{ message: string; data: any }> {
    try {
      const parsedId = parseInt(id, 10);
      if (isNaN(parsedId)) {
        throw new BadRequestException('ID doit être un nombre valide.');
      }

      return await this.articleService.analyzeArticlesByLevels(parsedId);
    } catch (error) {
      console.error('Erreur dans analyzeArticlesByLevels:', error);
      throw new BadRequestException('Erreur lors de l\'analyse des articles. Détails : ' + error.message);
    }
  }*/
}