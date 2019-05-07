const JobQueue = require('../../../lib/job')
const assert = require('assert')

/* eslint no-undef: 0 */

describe('JobQueue', () => {
  describe('create()', () => {
    it('should create a job', async () => {
      const queue = new JobQueue()
      const job = await queue.create({
        op: 'scaleUp',
        watcher: 'regular:all:all'
      })

      console.log(job)
    })
  })

  describe('exists()', () => {
    it('should find a job with the same data', async () => {
      const queue = new JobQueue()
      const data = {
        op: 'scaleUp',
        watcher: 'regular:all:all'
      }

      const job = await queue.create(data)

      const exists = await queue.exists(data)

      assert.strictEqual(exists, job.id)
    })

    it('should not find a job when using incorrect data', async () => {
      const queue = new JobQueue()
      const data = {
        op: 'scaleUp',
        watcher: 'regular:all:all'
      }

      await queue.create(data)
      const exists = await queue.exists({})

      assert.strictEqual(exists, -1)
    })
  })

  describe('startWatcher()', () => {
    it('should transition jobs properly', async () => {
      const queue = new JobQueue()
      queue.startWatcher()

      const job = await queue.create({
        op: 'scaleUp',
        watcher: 'regular:all:all'
      }, 0.01)

      return new Promise((resolve, reject) => {
        setTimeout(async () => {
          const jobs = await queue.ready()

          try {
            assert.strictEqual(jobs.length, 1)
            assert.strictEqual(jobs[0].id, job.id)
          } catch (err) {
            return reject(err)
          }

          return resolve()
        }, 1400)
      })
    })
  })

  describe('delete()', () => {
    it('should delete jobs correctly', async () => {
      const queue = new JobQueue()
      const job = await queue.create({
        op: 'scaleUp',
        watcher: 'regular:all:all'
      })

      const deletedJob = await queue.delete(job.id)
      assert.strictEqual(deletedJob.id, job.id)
    })
  })
})
