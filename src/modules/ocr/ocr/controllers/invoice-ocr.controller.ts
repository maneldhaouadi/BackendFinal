import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  HttpException,
  HttpStatus,
  Get,
  Query,
  Delete,
  Param,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as crypto from 'crypto';
import { existsSync, unlinkSync } from 'fs';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { InvoiceOcrProcessResponse } from '../dtos/invoice-ocr-result.dto';
import { InvoiceOcrService } from '../services/invoice-ocr.service';

@ApiTags('Invoice OCR Processing')
@Controller('invoice-ocr')
export class InvoiceOcrController {
  private readonly logger = new Logger(InvoiceOcrController.name);
  
  constructor(private readonly invoiceOcrService: InvoiceOcrService) {}

  @Post('process')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/invoice-ocr',
        filename: (req, file, cb) => {
          const randomName = crypto.randomBytes(16).toString('hex');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedTypes = [
          'image/png',
          'image/jpeg',
          'image/tiff',
          'image/bmp',
          'application/pdf',
        ];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new HttpException(
              `Unsupported file type ${file.mimetype}`,
              HttpStatus.BAD_REQUEST,
            ),
            false,
          );
        }
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Invoice file to process (image or PDF)',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @ApiQuery({
    name: 'strict',
    type: Boolean,
    required: false,
    description: 'Enable strict mode (rejects results with confidence < 85%)',
  })
  @ApiQuery({
    name: 'debug',
    type: Boolean,
    required: false,
    description: 'Enable debug mode (returns additional processing info)',
  })
  @ApiOperation({
    summary: 'Process invoice with OCR',
    description: 'Extracts structured data from invoice using OCR and AI processing',
  })
  @ApiResponse({
    status: 200,
    description: 'Invoice processed successfully',
    type: InvoiceOcrProcessResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid file or missing required fields',
  })
  @ApiResponse({
    status: 422,
    description: 'Low confidence score in strict mode',
  })
  @ApiResponse({
    status: 500,
    description: 'OCR processing error',
  })
  async processInvoice(
    @UploadedFile() file: Express.Multer.File,
    @Query('strict') strictMode: boolean = false,
    @Query('debug') debugMode: boolean = false,
  ): Promise<InvoiceOcrProcessResponse> {
    try {
      if (!file) {
        throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
      }

      if (!existsSync(file.path)) {
        throw new HttpException('File not found', HttpStatus.BAD_REQUEST);
      }

      const result = await this.invoiceOcrService.processInvoice(file.path, debugMode);

      if (strictMode && result.confidence < 85) {
        throw new HttpException(
          'Low confidence score in strict mode',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(`Invoice OCR processing failed: ${error.message}`, error.stack);
      if (file?.path && existsSync(file.path)) {
        this.invoiceOcrService.cleanupFile(file.path);
      }

      throw new HttpException(
        {
          success: false,
          message: error.message,
          statusCode: error.status || HttpStatus.INTERNAL_SERVER_ERROR,
        },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      if (file?.path && existsSync(file.path)) {
        this.invoiceOcrService.cleanupFile(file.path);
      }
    }
  }

  @Get('supported-formats')
  @ApiOperation({
    summary: 'Get supported file formats',
    description: 'Returns list of supported formats for invoice OCR processing',
  })
  @ApiResponse({
    status: 200,
    description: 'Supported formats list',
    schema: {
      type: 'object',
      properties: {
        formats: {
          type: 'array',
          items: { type: 'string' },
          example: ['png', 'jpg', 'jpeg', 'tiff', 'bmp', 'pdf'],
        },
        maxSize: { 
          type: 'string',
          example: '10MB',
        },
      },
    },
  })
  getSupportedFormats() {
    return {
      formats: ['png', 'jpg', 'jpeg', 'tiff', 'bmp', 'pdf'],
      maxSize: '10MB',
    };
  }

  @Delete('cleanup/:filename')
  @ApiOperation({
    summary: 'Cleanup uploaded invoice file',
    description: 'Manually cleanup an uploaded invoice file',
  })
  @ApiParam({
    name: 'filename',
    description: 'Name of the file to delete',
    example: 'abc123.jpg',
  })
  @ApiResponse({
    status: 200,
    description: 'File successfully deleted',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'File deleted successfully' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'File not found',
  })
  async cleanupFile(@Param('filename') filename: string) {
    const filePath = `./uploads/invoice-ocr/${filename}`;
    if (!existsSync(filePath)) {
      throw new HttpException('File not found', HttpStatus.NOT_FOUND);
    }

    try {
      this.invoiceOcrService.cleanupFile(filePath);
      return { success: true, message: 'File deleted successfully' };
    } catch (error) {
      throw new HttpException(
        'Failed to delete file',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}