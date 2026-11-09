import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArgs, intFlag } from '../lib/args.js';

describe('命令参数', () => {
  it('第一个词是子命令，其余按空格切', () => {
    const { word, positional, flags } = parseArgs('add 单文件不超过 400 行');
    assert.equal(word, 'add');
    assert.deepEqual(positional, ['单文件不超过', '400', '行']);
    assert.deepEqual(flags, {});
  });

  it('引号里的空格保留成一个参数，引号本身去掉', () => {
    const { positional } = parseArgs('add "所有导出的函数都要有 JSDoc 注释"');
    assert.deepEqual(positional, ['所有导出的函数都要有 JSDoc 注释']);
  });

  it('单引号同样生效，且能和裸词混排', () => {
    const { positional } = parseArgs("update R-003 '新的说法'");
    assert.deepEqual(positional, ['R-003', '新的说法']);
  });

  it('--flag 收成 true，--key=value 收成字符串并小写键名', () => {
    const { flags } = parseArgs('add 文本 --Level=SHOULD --confirm');
    assert.equal(flags.level, 'SHOULD');
    assert.equal(flags.confirm, true);
  });

  it('空输入不炸', () => {
    const { word, positional, flags } = parseArgs('   ');
    assert.equal(word, '');
    assert.deepEqual(positional, []);
    assert.deepEqual(flags, {});
  });

  it('intFlag 只认正整数', () => {
    assert.equal(intFlag('3'), 3);
    assert.equal(intFlag('0'), 0);
    assert.equal(intFlag('abc'), undefined);
    assert.equal(intFlag(true), undefined);
  });
});
