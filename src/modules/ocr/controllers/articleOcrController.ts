import { Controller, Post, UploadedFile, UseInterceptors, Body, HttpException, HttpStatus, Get } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { existsSync, unlinkSync } from 'fs';
import { ApiConsumes, ApiBody, ApiResponse, ApiTags, ApiOperation } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as crypto from 'crypto';
import { IOcrTextResult, IOcrArticleResult } from '../interfaces/ocr.interface';
import { ArticleOcrService } from '../services/articleOcrService';

@ApiTags('OCR Processing')
@Controller('ocr')
export class ArticleOcrController {
  constructor(private readonly ocrService: ArticleOcrService) {}

  private validateFile(file: Express.Multer.File): void {
    if (!file) throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    if (!existsSync(file.path)) throw new HttpException('Uploaded file not found', HttpStatus.BAD_REQUEST);
    if (file.size > 5 * 1024 * 1024) {
      throw new HttpException('File too large. Maximum size is 5MB', HttpStatus.BAD_REQUEST);
    }

    const validExtensions = ['.png', '.jpg', '.jpeg', '.tiff', '.bmp', '.pdf'];
    const fileExtension = extname(file.originalname).toLowerCase();
    if (!validExtensions.includes(fileExtension)) {
      throw new HttpException(
        `Unsupported file type. Allowed types: ${validExtensions.join(', ')}`,
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private cleanupFile(filePath: string): void {
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch (err) {
      console.error(`Failed to cleanup file ${filePath}:`, err);
    }
  }

  private handleError(error: any, defaultMessage: string): HttpException {
    const statusCode = error.status || HttpStatus.INTERNAL_SERVER_ERROR;
    return new HttpException(
      {
        success: false,
        message: error.message || defaultMessage,
        statusCode,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      statusCode
    );
  }

  @Post('extract-text')
  @UseInterceptors(FileInterceptor('image', {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const randomName = crypto.randomBytes(16).toString('hex');
        cb(null, `${randomName}${extname(file.originalname)}`);
      }
    })
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Extract text from image',
    description: 'Extracts text from an image with advanced correction and normalization'
  })
  @ApiBody({
    description: 'Image file to process',
    schema: {
      type: 'object',
      properties: {
        image: { type: 'string', format: 'binary' }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Text extracted successfully', 
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            corrections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  original: { type: 'string' },
                  corrected: { type: 'string' },
                  context: { type: 'array', items: { type: 'string' } },
                  confidence: { type: 'number' },
                  timestamp: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid file input' })
  @ApiResponse({ status: 500, description: 'OCR processing failed' })
  async extractText(@UploadedFile() file: Express.Multer.File): Promise<IOcrTextResult> {
    try {
      this.validateFile(file);
      const text = await this.ocrService.extractTextFromImage(file.path);
      const corrections = this.ocrService.getLastCorrections();
      
      this.cleanupFile(file.path);
      return { success: true, data: { text, corrections } };
    } catch (error) {
      if (file?.path) this.cleanupFile(file.path);
      throw this.handleError(error, 'OCR processing failed');
    }
  }

  @Post('extract-article')
  @UseInterceptors(FileInterceptor('image', {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const randomName = crypto.randomBytes(16).toString('hex');
        cb(null, `${randomName}${extname(file.originalname)}`);
      }
    })
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Extract article data from image',
    description: 'Processes an image containing article information and extracts structured data with advanced error correction.'
  })
  @ApiBody({
    description: 'Image file containing article data',
    schema: {
      type: 'object',
      properties: {
        image: { type: 'string', format: 'binary' }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Article data extracted successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            reference: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            quantityInStock: { type: 'number' },
            unitPrice: { type: 'number' },
            status: { type: 'string' },
            notes: { type: 'string' },
            version: { type: 'number' }
          }
        },
        corrections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              original: { type: 'string' },
              corrected: { type: 'string' },
              context: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'number' },
              timestamp: { type: 'string', format: 'date-time' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid file input' })
  @ApiResponse({ status: 500, description: 'Article extraction failed' })
  async extractArticle(@UploadedFile() file: Express.Multer.File): Promise<IOcrArticleResult> {
    try {
      this.validateFile(file);
      const text = await this.ocrService.extractTextFromImage(file.path);
      const articleData = await this.ocrService.extractArticleData(text);
      const corrections = this.ocrService.getLastCorrections();
      
      this.cleanupFile(file.path);
      return { 
        success: true, 
        data: articleData, 
        corrections 
      };
    } catch (error) {
      if (file?.path) this.cleanupFile(file.path);
      throw this.handleError(error, 'Article extraction failed');
    }
  }

  @Post('process-text')
  @ApiOperation({
    summary: 'Process text to extract article data',
    description: 'Processes text containing article information and extracts structured data with advanced error correction.'
  })
  @ApiBody({
    description: 'Text to process',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string' }
      },
      required: ['text']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Text processed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            reference: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            quantityInStock: { type: 'number' },
            unitPrice: { type: 'number' },
            status: { type: 'string' },
            notes: { type: 'string' },
            version: { type: 'number' }
          }
        },
        corrections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              original: { type: 'string' },
              corrected: { type: 'string' },
              context: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'number' },
              timestamp: { type: 'string', format: 'date-time' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid text input' })
  @ApiResponse({ status: 500, description: 'Text processing failed' })
  async processText(@Body() body: { text: string }): Promise<IOcrArticleResult> {
    try {
      if (!body?.text) {
        throw new HttpException(
          { success: false, message: 'Request body must contain a text property', statusCode: HttpStatus.BAD_REQUEST },
          HttpStatus.BAD_REQUEST
        );
      }
  
      const articleData = await this.ocrService.extractArticleData(body.text);
      const corrections = this.ocrService.getLastCorrections();
      return { success: true, data: articleData, corrections };
    } catch (error) {
      throw this.handleError(error, 'Text processing failed');
    }
  }

  @Get('supported-formats')
  @ApiOperation({
    summary: 'Get supported file formats',
    description: 'Returns a list of supported file formats for OCR processing'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Supported formats retrieved',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        formats: { type: 'array', items: { type: 'string' } },
        maxSize: { type: 'string' }
      }
    }
  })
  getSupportedFormats() {
    return {
      success: true,
      formats: ['image/png', 'image/jpeg', 'image/tiff', 'image/bmp', 'application/pdf'],
      maxSize: '5MB'
    };
  }
}